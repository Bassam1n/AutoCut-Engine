-- M1 done-when: "A user in org A cannot read or write any ... storage
-- object of org B." Tests RLS on storage.objects rows directly (the
-- actual file bytes are irrelevant to RLS — policies apply to the
-- metadata row in storage.objects, keyed by bucket_id + name/path, so
-- inserting a row here is equivalent to what an upload would produce for
-- the purpose of this test).

begin;
select plan(4);

insert into auth.users (id, email, aud, role)
values
  ('d0000000-0000-0000-0000-000000000001', 'storage-org-a@example.invalid', 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000001', 'storage-org-b@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values
  ('d1111111-1111-1111-1111-111111111111', '__test_storage_org_a'),
  ('e1111111-1111-1111-1111-111111111111', '__test_storage_org_b');

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true),
  ('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'owner', true);

-- Simulate an already-uploaded object for org B (as if the service role
-- or org B's own user had uploaded it).
insert into storage.objects (bucket_id, name, owner)
values ('refs', 'e1111111-1111-1111-1111-111111111111/some_ad/image_1.png', 'e0000000-0000-0000-0000-000000000001');

-- Impersonate org A's user and confirm they cannot see org B's object.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'refs' and name = 'e1111111-1111-1111-1111-111111111111/some_ad/image_1.png'),
  0,
  'org A user cannot see org B''s storage object row'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('refs', 'e1111111-1111-1111-1111-111111111111/some_ad/hostile.png', 'd0000000-0000-0000-0000-000000000001') $$,
  null, null,
  'org A user cannot insert a storage object row under org B''s path prefix'
);

-- Org A user CAN write under their own org's path.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('refs', 'd1111111-1111-1111-1111-111111111111/my_ad/image_1.png', 'd0000000-0000-0000-0000-000000000001') $$,
  'org A user CAN insert a storage object row under their own org''s path prefix'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'refs' and name = 'd1111111-1111-1111-1111-111111111111/my_ad/image_1.png'),
  1,
  'the legitimate same-org insert actually landed'
);

select * from finish();
rollback;
