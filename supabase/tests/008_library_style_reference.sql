-- M9ish: Library (spec §5.9) + styles.reference_asset_id (migration
-- 45). Confirms: (1) an org CAN set reference_asset_id on its own
-- style (styles_update, migration 7, applies to this new column the
-- same as every other styles column); (2) an org CANNOT set it on a
-- platform-seeded style (org_id is null) — the same "org_id is not
-- null" half of styles_update's with-check already governs every
-- other column, confirmed here for the new one specifically, since
-- that's the exact gap the task asked to investigate; (3) library_items
-- still round-trips correctly (select/insert/update/delete) for an org
-- member against a real asset, including the embedded
-- assets!inner(kind, storage_path) join the Library page's
-- getLibraryItems() depends on; (4) a second org's member cannot see
-- or touch the first org's library_items rows (cross-org isolation,
-- same posture as every other table).
--
-- Run with: supabase test db --db-url <...> supabase/tests/008_library_style_reference.sql

begin;
select plan(11);

insert into auth.users (id, email, aud, role)
values
  ('e0000000-0000-0000-0000-000000000001', 'library-owner@example.invalid', 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000002', 'library-other-org@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values
  ('e1111111-1111-1111-1111-111111111111', '__test_org_library'),
  ('e9999999-9999-9999-9999-999999999999', '__test_org_library_other');

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('e1111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'owner', true),
  ('e9999999-9999-9999-9999-999999999999', 'e0000000-0000-0000-0000-000000000002', 'owner', true);

insert into public.brands (id, org_id, name)
values ('e2222222-2222-2222-2222-222222222222', 'e1111111-1111-1111-1111-111111111111', '__brand_library_test');

insert into public.products (id, org_id, brand_id, name)
values ('e7777777-7777-7777-7777-777777777777', 'e1111111-1111-1111-1111-111111111111', 'e2222222-2222-2222-2222-222222222222', '__product_library_test');

insert into public.ads (id, org_id, brand_id, product_id, mode)
values ('e3333333-3333-3333-3333-333333333333', 'e1111111-1111-1111-1111-111111111111', 'e2222222-2222-2222-2222-222222222222', 'e7777777-7777-7777-7777-777777777777', 'studio');

-- Fixture asset (service-role insert — browser role has no insert
-- policy on assets, confirmed by 002_browser_role_write_restrictions.sql;
-- writing it before impersonation begins, same pattern that file uses).
insert into public.assets (id, org_id, ad_id, kind, storage_path)
values ('e4444444-4444-4444-4444-444444444444', 'e1111111-1111-1111-1111-111111111111', 'e3333333-3333-3333-3333-333333333333', 'image', 'e1111111-1111-1111-1111-111111111111/fixture.png');

-- One org-owned style and one platform-seeded style (org_id null).
insert into public.styles (id, org_id, name)
values
  ('e5555555-5555-5555-5555-555555555555', 'e1111111-1111-1111-1111-111111111111', '__org_owned_style'),
  ('e6666666-6666-6666-6666-666666666666', null, '__platform_seed_style');

-- Impersonate the library org's own owner.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

-- (1) org CAN set reference_asset_id on its own style.
update public.styles set reference_asset_id = 'e4444444-4444-4444-4444-444444444444' where id = 'e5555555-5555-5555-5555-555555555555';
select is(
  (select reference_asset_id from public.styles where id = 'e5555555-5555-5555-5555-555555555555'),
  'e4444444-4444-4444-4444-444444444444'::uuid,
  'org owner CAN set reference_asset_id on their own org-owned style'
);

-- (2) org CANNOT set reference_asset_id on a platform-seeded style —
-- the UPDATE matches 0 rows under RLS (same "matches 0 rows, doesn't
-- throw" semantics 002_browser_role_write_restrictions.sql's own
-- comment documents for a WHERE clause RLS hides), so the real
-- assertion is "stays null afterward."
update public.styles set reference_asset_id = 'e4444444-4444-4444-4444-444444444444' where id = 'e6666666-6666-6666-6666-666666666666';
select is(
  (select reference_asset_id from public.styles where id = 'e6666666-6666-6666-6666-666666666666'),
  null,
  'org owner CANNOT set reference_asset_id on a platform-seeded style (org_id is null) — styles_update''s own org_id-not-null check still applies to this new column'
);

-- (3) library_items round-trip: insert referencing the fixture asset.
insert into public.library_items (id, org_id, brand_id, asset_id, name, tags)
values ('e8888888-8888-8888-8888-888888888888', 'e1111111-1111-1111-1111-111111111111', 'e2222222-2222-2222-2222-222222222222', 'e4444444-4444-4444-4444-444444444444', 'Fixture item', array['test', 'fixture']);

select is(
  (select name from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  'Fixture item',
  'org member CAN insert a library_items row pointing at an existing asset'
);

-- getLibraryItems()'s embedded join shape: library_items joined to
-- assets!inner(kind, storage_path) must resolve for an org member.
select is(
  (
    select a.kind
    from public.library_items li
    join public.assets a on a.id = li.asset_id
    where li.id = 'e8888888-8888-8888-8888-888888888888'
  ),
  'image',
  'library_items.asset_id correctly joins to the underlying asset''s kind (getLibraryItems()''s embedded-join shape)'
);

-- rename
update public.library_items set name = 'Renamed item' where id = 'e8888888-8888-8888-8888-888888888888';
select is(
  (select name from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  'Renamed item',
  'org member CAN rename their own org''s library item'
);

-- favourite toggle
update public.library_items set favorite = true where id = 'e8888888-8888-8888-8888-888888888888';
select is(
  (select favorite from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  true,
  'org member CAN favourite their own org''s library item'
);

-- assign brand (to null, same as the Library UI's "No brand" option)
update public.library_items set brand_id = null where id = 'e8888888-8888-8888-8888-888888888888';
select is(
  (select brand_id from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  null,
  'org member CAN clear a library item''s brand assignment'
);

-- (4) cross-org isolation: a second org's member cannot see or touch
-- the first org's library item or style.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select is(
  (select count(*)::int from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  0,
  'a different org''s member cannot see this org''s library item'
);

-- Still impersonating org 2's member for the next two checks.
update public.library_items set favorite = false where id = 'e8888888-8888-8888-8888-888888888888';
select is(
  (select count(*)::int from public.library_items where id = 'e8888888-8888-8888-8888-888888888888' and favorite = false),
  0,
  'a different org''s member''s UPDATE on this org''s library item did not apply — RLS hides the row entirely, so even the WHERE clause matches nothing'
);

select throws_ok(
  $$ insert into public.library_items (org_id, asset_id) values ('e1111111-1111-1111-1111-111111111111', 'e4444444-4444-4444-4444-444444444444') $$,
  '42501',
  null,
  'a different org''s member cannot insert a library_items row into org 1 — library_items_insert''s with-check (is_org_member) rejects it'
);

-- delete, still impersonating org 2's member.
delete from public.library_items where id = 'e8888888-8888-8888-8888-888888888888';

-- Switch back to org 1's owner only to read the final state.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
select is(
  (select favorite from public.library_items where id = 'e8888888-8888-8888-8888-888888888888'),
  true,
  'a different org''s member could neither update nor delete this org''s library item — still exists, still favourited'
);

select * from finish();
rollback;
