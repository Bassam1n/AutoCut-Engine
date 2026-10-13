-- Per-scene cost visibility: spend_events/record_spend_event only ever
-- carried org_id/ad_id, so the cost breakdown could show "Image — kie"
-- totals but never which scene's repeated regenerations were actually
-- burning the budget. jobs.scene_id already exists and is already
-- populated for scene image/video jobs (request_scene_regen, migration
-- 00000000000014) and for per-scene voiceover jobs
-- (generate-voiceover.ts) — run-provider-job.ts and
-- generate-voiceover.ts both read job.scene_id already, just never
-- passed it on to record_spend_event. This is purely a "thread an
-- already-known id one hop further," not a new attribution problem.
--
-- target_scene_id is nullable and appended as the LAST parameter with
-- a default of null so every existing positional call (llm.call's
-- recordSpend, generate-reference-image.ts's cast/brand-level spend,
-- and the 3 positional calls in supabase/tests/004_spend_guard.sql)
-- keeps compiling unchanged — those call sites have no real scene to
-- attribute to (an LLM scripting call or a brand cast image spans the
-- whole ad/brand, not one scene) and should keep recording as
-- whole-ad/null-scene spend, not be forced to pass null explicitly.
alter table public.spend_events
  add column scene_id uuid references public.scenes(id) on delete set null;

create index spend_events_scene_id_idx on public.spend_events (scene_id) where scene_id is not null;

-- A trailing default-null parameter still changes the function's
-- signature as far as Postgres overload resolution is concerned —
-- `create or replace` only replaces an EXACT signature match, so
-- without this drop the old 6-arg version stays around alongside the
-- new 7-arg one and every existing positional 6-arg call (llm.call,
-- generate-reference-image.ts, supabase/tests/004_spend_guard.sql)
-- becomes ambiguous between the two and fails to resolve.
drop function if exists public.record_spend_event(uuid, uuid, text, text, numeric, text);

create or replace function public.record_spend_event(
  target_org_id uuid,
  target_ad_id uuid,
  target_provider text,
  target_model text,
  target_usd_est numeric,
  target_kind text,
  target_scene_id uuid default null
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

  insert into public.spend_events (org_id, ad_id, provider, model, usd_est, kind, scene_id)
  values (target_org_id, target_ad_id, target_provider, target_model, target_usd_est, target_kind, target_scene_id)
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
    insert into public.audit_log (org_id, actor, action, target)
    values (target_org_id, null, 'spend_guard_warn', current_spend::text);
  end if;

  return new_event;
end;
$$;

revoke execute on function public.record_spend_event(uuid, uuid, text, text, numeric, text, uuid) from anon, authenticated;
