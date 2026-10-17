-- M8 (spend admin, first slice) done-when: resuming a paused org is
-- restricted to an owner or admin and is logged (spec §5.10: "Only an
-- owner or admin can resume, and resuming is logged"). Tests
-- resume_org()'s admin gate using the same auth.uid() impersonation
-- trick 001_cross_org_isolation.sql already proves against RLS, since
-- resume_org (unlike claim_paid_job/record_spend_event) is meant to
-- be called by the browser role directly, not just the service role.
--
-- Run with: supabase test db --db-url <...> supabase/tests/005_resume_org.sql

begin;
select plan(6);

insert into auth.users (id, email, aud, role)
values
  ('d0000000-0000-0000-0000-000000000001', 'resume-org-owner@example.invalid', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'resume-org-editor@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, paused, pause_reason, warn_usd, stop_usd)
values ('d1111111-1111-1111-1111-111111111111', '__test_resume_org', true, 'Spend guard: 24h spend $22.00 crossed the $20.00 stop threshold', 10.00, 20.00);

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true),
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'editor', true);

-- An editor cannot resume the org (owner-only since migration 052).
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select throws_ok(
  $$ select public.resume_org('d1111111-1111-1111-1111-111111111111'::uuid) $$,
  'P0001',
  'only the owner of this org can resume it',
  'resume_org rejects a non-admin (editor) caller'
);

select is(
  (select paused from public.orgs where id = 'd1111111-1111-1111-1111-111111111111'::uuid),
  true,
  'org stays paused after a rejected non-admin resume attempt'
);

select is(
  (select count(*)::int from public.audit_log where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and action = 'spend_guard_resumed'),
  0,
  'no spend_guard_resumed audit row from the rejected non-admin attempt'
);

-- The owner can resume the org, and it is logged.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select lives_ok(
  $$ select public.resume_org('d1111111-1111-1111-1111-111111111111'::uuid) $$,
  'resume_org succeeds for an owner'
);

select is(
  (select paused from public.orgs where id = 'd1111111-1111-1111-1111-111111111111'::uuid),
  false,
  'org is unpaused after a successful resume'
);

select is(
  (select count(*)::int from public.audit_log where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and action = 'spend_guard_resumed' and actor = 'd0000000-0000-0000-0000-000000000001'::uuid),
  1,
  'resuming logs exactly one spend_guard_resumed audit row attributed to the resuming owner'
);

select * from finish();
rollback;
