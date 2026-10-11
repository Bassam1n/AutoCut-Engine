-- M3 done-when: "Pushing a test org past the stop threshold pauses new
-- paid jobs within one minute and lets running jobs finish." Tests
-- org_spend_24h(), record_spend_event()'s threshold checks, and
-- claim_paid_job()'s refusal once paused — all as the service role,
-- since these RPCs are service-role-only (real generation code calls
-- them, never the browser directly).
--
-- Run with: supabase test db --db-url <...> supabase/tests/004_spend_guard.sql

begin;
select plan(9);

insert into public.orgs (id, name, warn_usd, stop_usd)
values ('c1111111-1111-1111-1111-111111111111', '__test_spend_org', 10.00, 20.00);

-- org_spend_24h starts at 0 with no events.
select is(
  public.org_spend_24h('c1111111-1111-1111-1111-111111111111'::uuid),
  0::numeric,
  'org_spend_24h is 0 with no spend_events rows'
);

-- claim_paid_job succeeds while unpaused.
select lives_ok(
  $$ select public.claim_paid_job('c1111111-1111-1111-1111-111111111111'::uuid) $$,
  'claim_paid_job does not raise while the org is unpaused'
);

-- Record spend under both thresholds — org stays unpaused, no warn logged.
select public.record_spend_event(
  'c1111111-1111-1111-1111-111111111111'::uuid, null, 'kie', 'z-image', 5.00, 'image'
);

select is(
  public.org_spend_24h('c1111111-1111-1111-1111-111111111111'::uuid),
  5.00::numeric,
  'org_spend_24h reflects the one recorded event'
);

select is(
  (select paused from public.orgs where id = 'c1111111-1111-1111-1111-111111111111'::uuid),
  false,
  'org stays unpaused below the warn threshold'
);

select is(
  (select count(*)::int from public.audit_log where org_id = 'c1111111-1111-1111-1111-111111111111'::uuid and action = 'spend_guard_warn'),
  0,
  'no warn audit_log row below the warn threshold'
);

-- Cross the warn threshold (5 + 7 = 12, warn_usd is 10) — still unpaused, but a warn row is logged.
select public.record_spend_event(
  'c1111111-1111-1111-1111-111111111111'::uuid, null, 'kie', 'z-image', 7.00, 'image'
);

select is(
  (select paused from public.orgs where id = 'c1111111-1111-1111-1111-111111111111'::uuid),
  false,
  'org stays unpaused at the warn threshold, only the stop threshold pauses'
);

select is(
  (select count(*)::int from public.audit_log where org_id = 'c1111111-1111-1111-1111-111111111111'::uuid and action = 'spend_guard_warn'),
  1,
  'crossing the warn threshold logs exactly one spend_guard_warn audit row'
);

-- Cross the stop threshold (12 + 10 = 22, stop_usd is 20) — org pauses, claim_paid_job now refuses.
select public.record_spend_event(
  'c1111111-1111-1111-1111-111111111111'::uuid, null, 'kie', 'z-image', 10.00, 'image'
);

select is(
  (select paused from public.orgs where id = 'c1111111-1111-1111-1111-111111111111'::uuid),
  true,
  'org pauses once 24h spend crosses the stop threshold'
);

select throws_ok(
  $$ select public.claim_paid_job('c1111111-1111-1111-1111-111111111111'::uuid) $$,
  'P0001',
  null,
  'claim_paid_job raises once the org is paused'
);

select * from finish();
rollback;
