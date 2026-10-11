-- M3: spend guard core. Spec §5.10: "Rolling 24 hour estimated spend
-- per org. Warn threshold emails admins. Stop threshold sets
-- orgs.paused, which blocks new paid jobs while in-flight jobs finish.
-- Only an owner or admin can resume, and resuming is logged. Prices
-- never block a click by themselves, only the guard does."
--
-- org_spend_24h: the rolling-window read spec §4 names directly
-- ("org_spend_24h, pause flag and the claim guard"). A STABLE
-- function, not a materialized view — 24h spend needs to be exact at
-- read time, not refreshed on a schedule, and spend_events for one org
-- is a small enough row count that a live sum is cheap.
create or replace function public.org_spend_24h(target_org_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(usd_est), 0)
  from public.spend_events
  where org_id = target_org_id
    and created_at > now() - interval '24 hours';
$$;

-- Callable by any org member (matches spend_events' own select policy
-- — "editors see spend, that's the whole point of the spend admin
-- screen" per 00000000000012's own comment) and by the service role.
grant execute on function public.org_spend_24h(uuid) to authenticated;

-- record_spend_event: the ONE path that writes a spend_events row.
-- Spec §2 rule 9 requires spend to be "visible before the click,
-- recorded after" — recording goes through this RPC rather than a
-- direct table insert (spend_events already has no insert policy for
-- the browser role; this is the service-role-only write path real
-- provider-call code will use) so every write passes through the same
-- threshold check in the same transaction as the write, with no
-- window where a spend event exists but the guard hasn't evaluated it
-- yet.
create or replace function public.record_spend_event(
  target_org_id uuid,
  target_ad_id uuid,
  target_provider text,
  target_model text,
  target_usd_est numeric,
  target_kind text
)
returns public.spend_events
language plpgsql
security definer
set search_path = public
as $$
declare
  new_event public.spend_events;
  current_spend numeric;
  org_row public.orgs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'record_spend_event can only be called by the service role';
  end if;

  insert into public.spend_events (org_id, ad_id, provider, model, usd_est, kind)
  values (target_org_id, target_ad_id, target_provider, target_model, target_usd_est, target_kind)
  returning * into new_event;

  select public.org_spend_24h(target_org_id) into current_spend;
  select * into org_row from public.orgs where id = target_org_id;

  if current_spend >= org_row.stop_usd and not org_row.paused then
    update public.orgs
    set paused = true,
        pause_reason = format('Spend guard: 24h spend $%s crossed the $%s stop threshold', current_spend, org_row.stop_usd)
    where id = target_org_id;

    insert into public.audit_log (org_id, actor, action, target)
    values (target_org_id, null, 'spend_guard_paused', current_spend::text);
  elsif current_spend >= org_row.warn_usd and not org_row.paused then
    -- Warn threshold crossed. Email delivery isn't wired up yet (no
    -- SMTP provider connected) — this records the crossing as a
    -- durable, auditable fact so an admin notification can be built
    -- on top of audit_log later without another schema change, rather
    -- than silently doing nothing until email exists.
    insert into public.audit_log (org_id, actor, action, target)
    values (target_org_id, null, 'spend_guard_warn', current_spend::text);
  end if;

  return new_event;
end;
$$;

revoke execute on function public.record_spend_event(uuid, uuid, text, text, numeric, text) from anon, authenticated;

-- claim_paid_job: the enforcement point spec §5.10 names as "the claim
-- guard (paid jobs refused when paused)" — this is the gate any future
-- paid-job-creation code (M9's workflow engine, or sooner if a
-- generation call lands before M9) calls before incurring real
-- provider cost. Separate from create_ad/scene-level job tables
-- (which don't exist with a "paid" concept of their own yet) so this
-- can be adopted by whichever table actually ends up creating paid
-- jobs, without coupling the spend guard to one specific schema.
create or replace function public.claim_paid_job(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org_row public.orgs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'claim_paid_job can only be called by the service role';
  end if;

  select * into org_row from public.orgs where id = target_org_id;

  if org_row.id is null then
    raise exception 'org not found';
  end if;

  if org_row.paused then
    raise exception 'org_paused: %', coalesce(org_row.pause_reason, 'spend guard has paused this org');
  end if;
end;
$$;

revoke execute on function public.claim_paid_job(uuid) from anon, authenticated;
