-- M1 done-when: "A user in org A cannot read or write any row or storage
-- object of org B." This file tests the table-row half; storage object
-- isolation is tested in 003_storage_isolation.sql.
--
-- Run with: supabase test db --db-url <...> supabase/tests/001_cross_org_isolation.sql
--
-- Technique: create two orgs with one member each (via the service-role
-- connection pgTAP runs under), then use set_config() to impersonate each
-- user's auth.uid() and prove RLS actually blocks cross-org reads/writes
-- — the same JWT-claim impersonation trick already proven against
-- decide_gate() in a manual test before this suite was written.

begin;
select plan(10);

-- Fixtures: two orgs, one member each, plus one row in a representative
-- org-scoped table (brands) per org.
insert into auth.users (id, email, aud, role)
values
  ('a0000000-0000-0000-0000-000000000001', 'org-a-user@example.invalid', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000001', 'org-b-user@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values
  ('a1111111-1111-1111-1111-111111111111', '__test_org_a'),
  ('b1111111-1111-1111-1111-111111111111', '__test_org_b');

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('a1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'owner', true),
  ('b1111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 'owner', true);

insert into public.brands (id, org_id, name)
values
  ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', '__brand_a'),
  ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111', '__brand_b');

-- Impersonate org A's user.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select is(
  (select count(*)::int from public.brands where id = 'a2222222-2222-2222-2222-222222222222'),
  1,
  'org A user can read org A''s own brand'
);

select is(
  (select count(*)::int from public.brands where id = 'b2222222-2222-2222-2222-222222222222'),
  0,
  'org A user cannot read org B''s brand (RLS blocks cross-org select)'
);

select is(
  (select count(*)::int from public.orgs where id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'org A user cannot read org B''s orgs row'
);

select throws_ok(
  $$ insert into public.brands (org_id, name) values ('b1111111-1111-1111-1111-111111111111', '__hostile_insert') $$,
  '42501',
  null,
  'org A user cannot insert a brand into org B (RLS WITH CHECK blocks it)'
);

select is(
  (select count(*)::int from public.brands where name = '__hostile_insert'),
  0,
  'the blocked hostile insert did not actually land anywhere'
);

-- An UPDATE whose WHERE clause matches no RLS-visible rows doesn't throw
-- — it just updates 0 rows, the normal Postgres behavior for any WHERE
-- clause that matches nothing. The assertion that actually matters is
-- that the row is provably untouched afterward.
update public.brands set name = '__hijacked' where id = 'b2222222-2222-2222-2222-222222222222';

reset role;
select is(
  (select name from public.brands where id = 'b2222222-2222-2222-2222-222222222222'),
  '__brand_b',
  'org B''s brand name is untouched after org A''s attempted hijack'
);

-- Switch to org B's user and confirm the isolation holds in the other
-- direction too, not just A-blocked-from-B.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select is(
  (select count(*)::int from public.brands where id = 'b2222222-2222-2222-2222-222222222222'),
  1,
  'org B user can read org B''s own brand'
);

select is(
  (select count(*)::int from public.brands where id = 'a2222222-2222-2222-2222-222222222222'),
  0,
  'org B user cannot read org A''s brand'
);

select is(
  (select count(*)::int from public.org_members where org_id = 'a1111111-1111-1111-1111-111111111111'),
  0,
  'org B user cannot read org A''s membership roster'
);

reset role;
select is(
  (select count(*)::int from public.org_members where org_id = 'a1111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000001'),
  1,
  'service-role connection can still see org A''s real membership (sanity check — RLS applies to the authenticated role, not this test harness itself)'
);

select * from finish();
rollback;
