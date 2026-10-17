-- Clips uploaded onto an ad's timeline (migration 71): only someone who
-- can edit the ad gets its upload folder and can record a clip; the file
-- must really be in storage, under that ad's folder, a video and at most
-- 50 MB; clips are numbered from 1000 per ad; a clip the timeline uses
-- can't be removed; another agency can do none of it.

begin;
select plan(13);

insert into auth.users (id, email, aud, role) values
  ('a8000000-0000-0000-0000-000000000001', 'up-owner@example.invalid', 'authenticated', 'authenticated'),
  ('a8000000-0000-0000-0000-000000000003', 'up-other-org@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap) values
  ('a8111111-1111-1111-1111-111111111111', '__test_upload_org', 10),
  ('a8999999-9999-9999-9999-999999999999', '__test_upload_other_org', 10);

insert into public.org_members (org_id, user_id, role) values
  ('a8111111-1111-1111-1111-111111111111', 'a8000000-0000-0000-0000-000000000001', 'owner'),
  ('a8999999-9999-9999-9999-999999999999', 'a8000000-0000-0000-0000-000000000003', 'owner');

insert into public.brands (id, org_id, name) values
  ('a8222222-2222-2222-2222-222222222222', 'a8111111-1111-1111-1111-111111111111', '__up_brand');
insert into public.products (id, org_id, brand_id, name) values
  ('a8333333-3333-3333-3333-333333333333', 'a8111111-1111-1111-1111-111111111111', 'a8222222-2222-2222-2222-222222222222', '__up_product');
insert into public.ads (id, org_id, brand_id, product_id, mode) values
  ('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111', 'a8222222-2222-2222-2222-222222222222', 'a8333333-3333-3333-3333-333333333333', 'studio');

-- Files "uploaded" by the browser.
insert into storage.objects (bucket_id, name, metadata) values
  ('renders', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/a-clip.mp4', '{"mimetype":"video/mp4","size":1000000}'),
  ('renders', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/b-clip.mov', '{"mimetype":"video/quicktime","size":2000000}'),
  ('renders', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/c-photo.jpg', '{"mimetype":"image/jpeg","size":1000}'),
  ('renders', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/d-huge.mp4', '{"mimetype":"video/mp4","size":90000000}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  public.timeline_upload_folder('a8444444-4444-4444-4444-444444444444'),
  'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/',
  'the owner gets the ad''s upload folder'
);
select is(
  ((public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/a-clip.mp4', '{"name":"a-clip.mp4","duration":4.2,"width":1920,"height":1080}'::jsonb)).meta->>'clipIndex')::int,
  1000,
  'the first uploaded clip is footage 1000'
);
select is(
  ((public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/b-clip.mov', '{"name":"b-clip.mov","duration":3}'::jsonb)).meta->>'clipIndex')::int,
  1001,
  'the next one is 1001'
);
select throws_ok(
  $$ select public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/a-clip.mp4', '{"duration":4.2}'::jsonb) $$,
  'that clip is already on this ad',
  'a file is recorded once'
);
select throws_ok(
  $$ select public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/missing.mp4', '{"duration":2}'::jsonb) $$,
  'the upload did not finish; try again',
  'the file must be in storage'
);
select throws_ok(
  $$ select public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/other-ad/a-clip.mp4', '{"duration":2}'::jsonb) $$,
  'invalid upload path',
  'only files in this ad''s upload folder'
);
select throws_ok(
  $$ select public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/c-photo.jpg', '{"duration":2}'::jsonb) $$,
  'only video files can go on the timeline',
  'only video files'
);
select throws_ok(
  $$ select public.add_timeline_upload('a8444444-4444-4444-4444-444444444444', 'a8111111-1111-1111-1111-111111111111/renders/a8444444-4444-4444-4444-444444444444/auto-edit/uploads/d-huge.mp4', '{"duration":2}'::jsonb) $$,
  'clips can be up to 50 MB',
  'at most 50 MB'
);

-- A clip the timeline uses stays; one it doesn't can go.
select lives_ok(
  $$ select public.create_ad_timeline('a8444444-4444-4444-4444-444444444444', '{"clips":[{"scene":1000}]}'::jsonb, 'clean', '{}'::jsonb) $$,
  'a timeline that uses clip 1000'
);
select throws_ok(
  $$ select public.remove_timeline_upload((select id from public.assets where kind = 'broll' and (meta->>'clipIndex')::int = 1000 and ad_id = 'a8444444-4444-4444-4444-444444444444')) $$,
  'this clip is on the timeline; take it off the timeline first',
  'a clip on the timeline cannot be removed'
);
select lives_ok(
  $$ select public.remove_timeline_upload((select id from public.assets where kind = 'broll' and (meta->>'clipIndex')::int = 1001 and ad_id = 'a8444444-4444-4444-4444-444444444444')) $$,
  'an unused clip can be removed'
);

-- Another agency.
select set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.timeline_upload_folder('a8444444-4444-4444-4444-444444444444') $$,
  'you don''t have access to this ad',
  'another agency gets no upload folder'
);
reset role;
select is(
  (select archived from public.assets where kind = 'broll' and (meta->>'clipIndex')::int = 1001 and ad_id = 'a8444444-4444-4444-4444-444444444444'),
  true,
  'the removed clip is archived, for the purge to delete'
);

select * from finish();
rollback;
