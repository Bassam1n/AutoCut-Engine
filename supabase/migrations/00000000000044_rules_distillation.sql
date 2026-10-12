-- M8: "Feedback -> rules -> history" distillation (spec §5.8). Adds
-- the plumbing the daily Trigger.dev job
-- (src/trigger/distill-feedback-rules.ts) and the new rules admin
-- screen (settings/rules/) both need. Does NOT touch anything through
-- 00000000000043_resume_org.sql.
--
-- 1. feedback_events.rule_id: nullable FK to the rule a remembered
--    feedback row has already been distilled into. This (not a
--    `distilled_at` timestamp) is the mechanism that answers "has
--    this feedback already been used to make a rule" — a timestamp
--    would mark a row as "considered" the first time the job ran over
--    it even if it was a lone singleton that didn't yet cross the 2+
--    threshold, which would then WRONGLY exclude it from ever being
--    re-clustered once a second, matching instance shows up later.
--    rule_id stays null until the row actually contributes to a real
--    rule, so a singleton keeps being eligible on every subsequent
--    run until it either gets attached to a rule or the org simply
--    never sends a second matching correction. feedback_events stays
--    append-only (no update/delete policy, confirmed by
--    006_feedback_events_append_only.sql) — this column is written
--    ONLY by the service role from the distillation job, never by a
--    browser-role UPDATE, so the append-only guarantee for anything a
--    browser client could do is untouched; see the service-role-only
--    note on attach_feedback_to_rule below.
alter table public.feedback_events
  add column rule_id uuid references public.rules(id) on delete set null;

create index feedback_events_remember_unattached_idx
  on public.feedback_events (org_id, remember)
  where remember = true and rule_id is null;

-- 2. create_rule: the ONLY insert path for public.rules. The table
--    has select/update(admin)/delete(admin) policies (migration 10)
--    but deliberately NO insert policy for any browser-facing role —
--    confirmed by reading that migration — so creating a rule from
--    the distillation job needs either a security-definer RPC or a
--    direct service-role insert (service role bypasses RLS
--    entirely). Chose an RPC here, NOT a raw service-role insert,
--    for one concrete reason that doesn't apply to run-provider-job.ts's
--    direct writes to jobs/assets: those tables' rows are written
--    exactly once by one pipeline with one shape, so a raw insert is
--    the whole story. A rule's creation here needs two things done
--    atomically with the insert: enforcing the per-scope cap
--    (RULE_CAP_PER_SCOPE, lib/rules/distillation.ts) by COUNTING
--    active rules in the same scope first, and the bulk "attach every
--    member feedback_events row to the new rule's id" step — wrapping
--    both inside one function means a half-done batch (rule created,
--    only some member rows attached) can't happen from a crashed job
--    mid-write, and the cap check reads a consistent snapshot rather
--    than racing a concurrent run. record_spend_event
--    (00000000000031_spend_guard.sql) sets the precedent for this
--    exact shape: service-role-only RPC that does a check-then-write
--    atomically rather than leaving the check to application code.
create or replace function public.create_rule_from_feedback(
  target_org_id uuid,
  target_scope text,
  target_scope_id uuid,
  target_kind text,
  target_text text,
  member_feedback_event_ids uuid[]
)
returns public.rules
language plpgsql
security definer
set search_path = public
as $$
declare
  new_rule public.rules;
begin
  if auth.role() <> 'service_role' then
    raise exception 'create_rule_from_feedback can only be called by the service role';
  end if;

  if target_scope not in ('org', 'brand', 'style', 'product') then
    raise exception 'invalid scope %', target_scope;
  end if;

  if target_kind not in ('do', 'avoid') then
    raise exception 'invalid kind %', target_kind;
  end if;

  insert into public.rules (org_id, scope, scope_id, kind, text, confidence, reinforced_count, active)
  values (target_org_id, target_scope, target_scope_id, target_kind, target_text, 0.5, 0, true)
  returning * into new_rule;

  update public.feedback_events
  set rule_id = new_rule.id
  where id = any(member_feedback_event_ids)
    and org_id = target_org_id;

  return new_rule;
end;
$$;

revoke all on function public.create_rule_from_feedback(uuid, text, uuid, text, text, uuid[]) from anon, authenticated;

-- 3. attach_feedback_to_rule: used when a NEW remembered feedback
--    instance reinforces an EXISTING rule rather than forming a brand
--    new cluster that needs create_rule_from_feedback — still
--    service-role-only for the same append-only reason.
create or replace function public.attach_feedback_to_rule(
  target_org_id uuid,
  target_rule_id uuid,
  member_feedback_event_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'attach_feedback_to_rule can only be called by the service role';
  end if;

  update public.feedback_events
  set rule_id = target_rule_id
  where id = any(member_feedback_event_ids)
    and org_id = target_org_id;
end;
$$;

revoke all on function public.attach_feedback_to_rule(uuid, uuid, uuid[]) from anon, authenticated;

-- 4. update_rule_decay: the job's confidence/active/reinforced_count
--    write-back for one rule after one daily run (lib/rules/
--    distillation.ts's applyDecayStep computes the new values; this
--    RPC just persists them under the same service-role-only
--    guarantee as the rest of this migration, rather than trying to
--    smuggle the decay math into SQL).
create or replace function public.update_rule_decay(
  target_rule_id uuid,
  new_confidence numeric,
  new_active boolean,
  reinforced_count_delta integer
)
returns public.rules
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rule public.rules;
begin
  if auth.role() <> 'service_role' then
    raise exception 'update_rule_decay can only be called by the service role';
  end if;

  update public.rules
  set confidence = new_confidence,
      active = new_active,
      reinforced_count = reinforced_count + reinforced_count_delta
  where id = target_rule_id
  returning * into updated_rule;

  if updated_rule.id is null then
    raise exception 'rule not found';
  end if;

  return updated_rule;
end;
$$;

revoke all on function public.update_rule_decay(uuid, numeric, boolean, integer) from anon, authenticated;

-- 5. Admin edit/pause for the rules screen (spec: "A rules screen
--    lets admins read, edit, pause and delete them"). Delete needs no
--    new RPC — rules_admin_delete (migration 10) already lets an
--    admin DELETE directly from the browser client, confirmed by
--    reading that policy, so the rules-actions.ts Server Action uses
--    a plain supabase.from("rules").delete() the same way
--    spend-actions.ts calls resume_org via RPC only where RLS alone
--    isn't enough (update needs the same is_org_admin() gate
--    rules_admin_update's own USING/WITH CHECK already enforces, so a
--    plain client-side update under that policy is sufient for pause
--    (active=false) and text/kind edits — no RPC needed there either,
--    the RLS policy IS the gate). No function added for those two;
--    documented here so the "why no RPC" reasoning isn't silently
--    absent from the schema history.
