-- Role hierarchy from migration 52: team management is owner-only,
-- admins can read the roster but not change it, nobody edits their own
-- row or an owner's row from inside the org, "owner" can't be handed
-- out inside the org, the audit log is owner-only, a deactivated seat
-- loses membership, and profiles are writable only by their owner.

begin;
select plan(16);

insert into auth.users (id, email, aud, role) values
  ('e0000000-0000-0000-0000-000000000001', 'role-test-owner@example.invalid', 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000002', 'role-test-admin@example.invalid', 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000003', 'role-test-editor@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap)
values ('e1111111-1111-1111-1111-111111111111', '__test_org_role_hierarchy', 10);

insert into public.org_members (org_id, user_id, role, seat_active) values
  ('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'owner', true),
  ('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000002', 'admin', true),
  ('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000003', 'editor', true);

-- Admin: can view, can't manage.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select public.invite_member('e1111111-1111-1111-1111-111111111111', 'new1@example.invalid', 'editor') $$,
  'only the owner of this org can invite a member',
  'admin cannot invite'
);
select lives_ok(
  $$ select * from public.list_org_team('e1111111-1111-1111-1111-111111111111') $$,
  'admin can view the roster'
);
select throws_ok(
  $$ select * from public.list_org_audit_log('e1111111-1111-1111-1111-111111111111') $$,
  'only the owner of this org can view its audit log',
  'admin cannot read the audit log'
);
select throws_ok(
  $$ select public.set_org_member_role('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000003', 'admin') $$,
  'only the owner of this org can manage members',
  'admin cannot change roles'
);

-- Owner: manages admins and users, never owners or themselves.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.invite_member('e1111111-1111-1111-1111-111111111111', 'new2@example.invalid', 'owner') $$,
  'invalid role: owner (owners are assigned by the platform admin)',
  'owner cannot invite another owner'
);
select lives_ok(
  $$ select public.invite_member('e1111111-1111-1111-1111-111111111111', 'new3@example.invalid', 'admin') $$,
  'owner can invite an admin'
);
select throws_ok(
  $$ select public.set_org_member_role('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'admin') $$,
  'you can''t change your own membership',
  'owner cannot change their own role'
);
select throws_ok(
  $$ select public.set_org_member_role('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000002', 'owner') $$,
  'invalid role: owner (owners are assigned by the platform admin)',
  'owner cannot promote someone to owner'
);
select lives_ok(
  $$ select public.set_org_member_role('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000002', 'editor') $$,
  'owner can change an admin to user'
);
select throws_ok(
  $$ select public.set_org_member_seat_active('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', false) $$,
  'you can''t change your own membership',
  'owner cannot deactivate themselves'
);
select lives_ok(
  $$ select * from public.list_org_audit_log('e1111111-1111-1111-1111-111111111111') $$,
  'owner can read the audit log'
);
select lives_ok(
  $$ select public.set_org_member_seat_active('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000003', false) $$,
  'owner can deactivate a user'
);

-- Deactivated user loses membership (is_org_member now checks seat_active).
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(
  public.is_org_member('e1111111-1111-1111-1111-111111111111'),
  false,
  'a deactivated seat is no longer a member'
);
select throws_ok(
  $$ select * from public.list_org_team('e1111111-1111-1111-1111-111111111111') $$,
  'only an owner or admin of this org can list its members',
  'a user cannot view the roster'
);

-- Profiles: own row only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.profiles (user_id, full_name) values ('e0000000-0000-0000-0000-000000000002', 'Admin A') $$,
  'a member can create their own profile'
);
select throws_ok(
  $$ insert into public.profiles (user_id, full_name) values ('e0000000-0000-0000-0000-000000000001', 'Not me') $$,
  '42501',
  null,
  'a member cannot write someone else''s profile'
);

reset role;
select * from finish();
rollback;
