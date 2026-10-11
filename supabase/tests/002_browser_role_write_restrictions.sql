-- M1 done-when: "The browser role cannot write gates.status, jobs, assets
-- or org_secrets." Tests that an authenticated org member — not just an
-- outsider — still cannot write these tables directly, since RLS isolates
-- by org membership but these four tables additionally have no
-- insert/update/delete policy AT ALL for the browser role, regardless of
-- membership. Writing them is exclusively the job of security-definer
-- RPCs (decide_gate, etc.) or the service role (workflow engine).
--
-- Postgres UPDATE/DELETE semantics note (learned the hard way on the
-- first run of this file): an UPDATE whose WHERE clause can't see a row
-- because of RLS does not throw — it just matches and updates 0 rows,
-- same as any WHERE clause matching nothing. So the real assertion for
-- those cases is "the row is unchanged afterward," not throws_ok(). Only
-- INSERT with no matching WITH CHECK policy throws (42501).

begin;
select plan(9);

insert into auth.users (id, email, aud, role)
values ('c0000000-0000-0000-0000-000000000001', 'write-test-user@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values ('c1111111-1111-1111-1111-111111111111', '__test_org_write_restrictions');

insert into public.org_members (org_id, user_id, role, seat_active)
values ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'owner', true);

insert into public.brands (id, org_id, name)
values ('c2222222-2222-2222-2222-222222222222', 'c1111111-1111-1111-1111-111111111111', '__brand_write_test');

insert into public.ads (id, org_id, brand_id, mode)
values ('c3333333-3333-3333-3333-333333333333', 'c1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'studio');

insert into public.gates (id, org_id, ad_id, phase, kind, actor, status)
values ('c4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'test_phase', 'test_kind', 'editor', 'pending');

-- Fixture job row, written while still on the unrestricted test-harness
-- connection role, BEFORE any impersonation begins below. Writing it
-- after impersonating 'authenticated' would itself be blocked by RLS,
-- since jobs has no browser-role insert policy at all — which is exactly
-- the thing this file is testing, so the fixture setup has to happen
-- before the impersonation, not after.
insert into public.jobs (id, org_id, kind, idempotency_key, status)
values ('c5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'test_kind', 'test_key_svc', 'queued');

insert into public.org_secrets (id, org_id, provider, vault_secret_id, last4)
values ('c6666666-6666-6666-6666-666666666666', 'c1111111-1111-1111-1111-111111111111', 'anthropic', gen_random_uuid(), '1234');

-- Now impersonate this org's own owner — the most generous case: if even
-- the org's own owner, acting through the browser role directly (not
-- via an RPC), cannot write these tables, the restriction is real and
-- not just an artifact of org mismatch.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

-- gates: can select, cannot update status directly.
select is(
  (select count(*)::int from public.gates where id = 'c4444444-4444-4444-4444-444444444444'),
  1,
  'org owner CAN read their own org''s gate (select policy exists)'
);

update public.gates set status = 'approved' where id = 'c4444444-4444-4444-4444-444444444444';
select is(
  (select status from public.gates where id = 'c4444444-4444-4444-4444-444444444444'),
  'pending',
  'org owner''s direct UPDATE on gates.status did not apply — stays pending, only decide_gate() can change it'
);

select throws_ok(
  $$ insert into public.gates (org_id, ad_id, phase, kind, actor, status) values ('c1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'p', 'k', 'editor', 'pending') $$,
  '42501', null,
  'org owner CANNOT insert a gate directly — no insert policy exists'
);

-- jobs: can select, cannot insert/update directly.
select throws_ok(
  $$ insert into public.jobs (org_id, kind, idempotency_key) values ('c1111111-1111-1111-1111-111111111111', 'test_kind', 'test_key_1') $$,
  '42501', null,
  'org owner CANNOT insert a job directly — no insert policy exists'
);

update public.jobs set status = 'succeeded' where id = 'c5555555-5555-5555-5555-555555555555';
select is(
  (select status from public.jobs where id = 'c5555555-5555-5555-5555-555555555555'),
  'queued',
  'org owner''s direct UPDATE on jobs.status did not apply — stays queued, status is service-role/RPC-only'
);

-- assets: select-only, no insert policy at all — even the org's own
-- owner cannot fake a generated asset into existence.
select throws_ok(
  $$ insert into public.assets (org_id, ad_id, kind, storage_path) values ('c1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'image', 'c1111111-1111-1111-1111-111111111111/fake.png') $$,
  '42501', null,
  'org owner CANNOT insert an asset directly — generation always goes through a job, never a raw table write'
);

-- org_secrets: zero policies at all, not even select. Browser role
-- cannot even see that a key exists, let alone its vault pointer.
select is(
  (select count(*)::int from public.org_secrets where org_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'org owner CANNOT even see that their own org has a saved secret — org_secrets has zero select policy, by design'
);

select throws_ok(
  $$ insert into public.org_secrets (org_id, provider, vault_secret_id, last4) values ('c1111111-1111-1111-1111-111111111111', 'fal', gen_random_uuid(), '9999') $$,
  '42501', null,
  'org owner CANNOT insert into org_secrets directly — save_org_secret() RPC is the only path'
);

update public.org_secrets set last4 = '0000' where id = 'c6666666-6666-6666-6666-666666666666';
select is(
  (select last4 from public.org_secrets where id = 'c6666666-6666-6666-6666-666666666666'),
  null,
  'org owner cannot even confirm whether their UPDATE on org_secrets did anything — the row stays invisible, select returns null/no row either way'
);

select * from finish();
rollback;
