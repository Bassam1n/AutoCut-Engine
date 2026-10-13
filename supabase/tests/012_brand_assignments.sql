-- Brand assignment from migration 54: a user (editor) sees and works
-- on only the brands assigned to them, down through products and ads;
-- owners and admins see every brand; only owners/admins assign, and
-- only users can be assigned; unassigning removes access.

begin;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-0000-0000-000000000001', 'assign-owner@example.invalid', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000002', 'assign-admin@example.invalid', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000003', 'assign-user1@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap)
values ('f1111111-1111-1111-1111-111111111111', '__test_org_brand_assignments', 10);

insert into public.org_members (org_id, user_id, role) values
  ('f1111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000001', 'owner'),
  ('f1111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000002', 'admin'),
  ('f1111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-000000000003', 'editor');

insert into public.brands (id, org_id, name) values
  ('f2222222-2222-2222-2222-222222222221', 'f1111111-1111-1111-1111-111111111111', '__assigned_brand'),
  ('f2222222-2222-2222-2222-222222222222', 'f1111111-1111-1111-1111-111111111111', '__other_brand');

insert into public.products (id, org_id, brand_id, name) values
  ('f3333333-3333-3333-3333-333333333331', 'f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', '__p1'),
  ('f3333333-3333-3333-3333-333333333332', 'f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', '__p2');

insert into public.ads (id, org_id, brand_id, product_id, mode) values
  ('f4444444-4444-4444-4444-444444444441', 'f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', 'f3333333-3333-3333-3333-333333333331', 'studio'),
  ('f4444444-4444-4444-4444-444444444442', 'f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', 'f3333333-3333-3333-3333-333333333332', 'studio');

set local role authenticated;

-- Admin assigns user1 to the first brand only.
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ select public.set_brand_assignees('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', array['f0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'admin can assign a user to a brand'
);
select throws_ok(
  $$ select public.set_brand_assignees('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', array['f0000000-0000-0000-0000-000000000001']::uuid[]) $$,
  'only users in this org can be assigned to a brand',
  'owners and admins are not assignable'
);
select is(
  (select count(*)::int from public.brands where org_id = 'f1111111-1111-1111-1111-111111111111'),
  2,
  'admin sees every brand'
);

-- User1: only the assigned brand and what's under it.
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.set_brand_assignees('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', array['f0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'only an owner or admin can assign brands',
  'a user cannot assign brands'
);
select is(
  (select count(*)::int from public.brands where org_id = 'f1111111-1111-1111-1111-111111111111'),
  1,
  'user sees only the assigned brand'
);
select is(
  (select count(*)::int from public.products where org_id = 'f1111111-1111-1111-1111-111111111111'),
  1,
  'user sees only the assigned brand''s products'
);
select is(
  (select count(*)::int from public.ads where org_id = 'f1111111-1111-1111-1111-111111111111'),
  1,
  'user sees only the assigned brand''s ads'
);
select throws_ok(
  $$ insert into public.ads (org_id, brand_id, product_id, mode) values ('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', 'f3333333-3333-3333-3333-333333333332', 'studio') $$,
  '42501',
  null,
  'user cannot create an ad in an unassigned brand'
);
select lives_ok(
  $$ insert into public.ads (org_id, brand_id, product_id, mode) values ('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', 'f3333333-3333-3333-3333-333333333331', 'studio') $$,
  'user can create an ad in the assigned brand'
);
select is_empty(
  $$ update public.ads set name = 'x' where id = 'f4444444-4444-4444-4444-444444444442' returning id $$,
  'user cannot edit an ad in an unassigned brand'
);

-- Unassigning removes access.
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_brand_assignees('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222221', array[]::uuid[]);

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.brands where org_id = 'f1111111-1111-1111-1111-111111111111'),
  0,
  'unassigned user sees no brands'
);

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.brands where org_id = 'f1111111-1111-1111-1111-111111111111'),
  2,
  'owner sees every brand'
);

reset role;
select * from finish();
rollback;
