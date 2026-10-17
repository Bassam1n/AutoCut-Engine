-- M10 (voiceover slice, migration 46): request_ad_voiceover() is the
-- new ad-scoped job-creation RPC (request_scene_regen, migration 14,
-- is scene-scoped and can't represent a whole-ad voiceover that has
-- no single scene). This proves: cross-org members are rejected, the
-- created job is ad-scoped with scene_id null, and two calls produce
-- two distinct idempotency keys (no accidental de-dup of a legitimate
-- re-request).
--
-- Run with: supabase test db --db-url <...> supabase/tests/009_ad_voiceover_job.sql

begin;
select plan(6);

insert into auth.users (id, email, aud, role)
values
  ('d0000000-0000-0000-0000-000000000001', 'vo-org-a@example.invalid', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'vo-org-b@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values
  ('d1111111-1111-1111-1111-111111111111', '__test_vo_org_a'),
  ('d9999999-9999-9999-9999-999999999999', '__test_vo_org_b');

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true),
  ('d9999999-9999-9999-9999-999999999999', 'd0000000-0000-0000-0000-000000000002', 'owner', true);

insert into public.brands (id, org_id, name)
values ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', '__brand_vo');

insert into public.products (id, org_id, brand_id, name)
values ('d7777777-7777-7777-7777-777777777777', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', '__product_vo');

insert into public.ads (id, org_id, brand_id, product_id, mode)
values ('d3333333-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'd7777777-7777-7777-7777-777777777777', 'studio');

-- Impersonate org A's own owner.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select lives_ok(
  $$ select public.request_ad_voiceover('d3333333-3333-3333-3333-333333333333'::uuid) $$,
  'org A member can request a voiceover job for their own ad'
);

select is(
  (select ad_id from public.jobs where kind = 'generate_ad_voiceover' and org_id = 'd1111111-1111-1111-1111-111111111111' order by created_at desc limit 1),
  'd3333333-3333-3333-3333-333333333333'::uuid,
  'the created job is attributed to the right ad'
);

select is(
  (select scene_id from public.jobs where kind = 'generate_ad_voiceover' and org_id = 'd1111111-1111-1111-1111-111111111111' order by created_at desc limit 1),
  null,
  'the created job has scene_id null — whole-ad voiceover is not scene-scoped'
);

-- A second request for the same ad gets its own distinct idempotency
-- key (a legitimate re-request, e.g. after editing the script, must
-- not collide with the first).
select public.request_ad_voiceover('d3333333-3333-3333-3333-333333333333'::uuid);
select is(
  (select count(distinct idempotency_key)::int from public.jobs where kind = 'generate_ad_voiceover' and ad_id = 'd3333333-3333-3333-3333-333333333333'),
  2,
  'two separate requests for the same ad get two distinct idempotency keys'
);

-- Switch to org B's user and confirm cross-org rejection.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select throws_ok(
  $$ select public.request_ad_voiceover('d3333333-3333-3333-3333-333333333333'::uuid) $$,
  'P0001',
  'you don''t have access to this ad',
  'org B member cannot request a voiceover job for org A''s ad'
);

reset role;
select is(
  (select count(*)::int from public.jobs where kind = 'generate_ad_voiceover' and ad_id = 'd3333333-3333-3333-3333-333333333333'),
  2,
  'the rejected cross-org attempt did not create a job row'
);

select * from finish();
rollback;
