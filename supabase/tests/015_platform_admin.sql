-- Platform admin controls from migration 58: only platform admins can
-- read the agency overview or suspend; suspension cuts members off and
-- reactivation restores them; invites into an agency ignore the seat
-- cap; a platform admin can't revoke themselves, and a revoked admin
-- loses access.

begin;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-0000-0000-000000000001', 'pa-admin@example.invalid', 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000002', 'pa-member@example.invalid', 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000003', 'pa-second@example.invalid', 'authenticated', 'authenticated');

insert into public.platform_admins (user_id) values
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003');

insert into public.orgs (id, name, seat_cap) values ('c1111111-1111-1111-1111-111111111111', '__test_org_platform', 1);
insert into public.org_members (org_id, user_id, role) values
  ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'owner');

set local role authenticated;

-- A regular member can't use platform controls.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.platform_set_org_suspended('c1111111-1111-1111-1111-111111111111', true, null) $$,
  null,
  'a member cannot suspend their agency'
);
select ok(public.is_org_member('c1111111-1111-1111-1111-111111111111'), 'the owner is a member before suspension');

-- The platform admin suspends the agency.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(
  exists (select 1 from public.platform_org_overview() where org_id = 'c1111111-1111-1111-1111-111111111111'),
  'the overview lists the agency'
);
select public.platform_set_org_suspended('c1111111-1111-1111-1111-111111111111', true, 'Invoice overdue');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(not public.is_org_member('c1111111-1111-1111-1111-111111111111'), 'suspension removes membership access');
select is(
  (select count(*)::int from public.my_suspended_orgs()),
  1,
  'the member can see that their agency is suspended'
);

-- Reactivate.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.platform_set_org_suspended('c1111111-1111-1111-1111-111111111111', false, null);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(public.is_org_member('c1111111-1111-1111-1111-111111111111'), 'reactivation restores access');

-- Platform invites ignore the full seat cap.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.platform_invite_member('c1111111-1111-1111-1111-111111111111', 'pa-new@example.invalid', 'editor') $$,
  'a platform admin can invite past the seat cap'
);

-- Admin management.
select throws_ok(
  $$ select public.revoke_platform_admin('c0000000-0000-0000-0000-000000000001') $$,
  null,
  'a platform admin cannot revoke themselves'
);
select public.revoke_platform_admin('c0000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not public.is_platform_admin(), 'a revoked admin loses platform access');

reset role;
select * from finish();
rollback;
