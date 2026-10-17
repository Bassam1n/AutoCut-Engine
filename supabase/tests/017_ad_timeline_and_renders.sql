-- The ad timeline and its renders (migration 70): the browser reads its
-- brand's timeline and renders and can't write either table; saves go
-- through save_ad_timeline with an optimistic version check and are
-- refused while an Auto-edit works on the timeline; a revision chat turn
-- snapshots the timeline; an earlier cut can be put back; one render job
-- per ad at a time; another agency sees and changes nothing.

begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('a7000000-0000-0000-0000-000000000001', 'tl-owner@example.invalid', 'authenticated', 'authenticated'),
  ('a7000000-0000-0000-0000-000000000003', 'tl-other-org@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap) values
  ('a7111111-1111-1111-1111-111111111111', '__test_timeline_org', 10),
  ('a7999999-9999-9999-9999-999999999999', '__test_timeline_other_org', 10);

insert into public.org_members (org_id, user_id, role) values
  ('a7111111-1111-1111-1111-111111111111', 'a7000000-0000-0000-0000-000000000001', 'owner'),
  ('a7999999-9999-9999-9999-999999999999', 'a7000000-0000-0000-0000-000000000003', 'owner');

insert into public.brands (id, org_id, name) values
  ('a7222222-2222-2222-2222-222222222222', 'a7111111-1111-1111-1111-111111111111', '__tl_brand');
insert into public.products (id, org_id, brand_id, name) values
  ('a7333333-3333-3333-3333-333333333333', 'a7111111-1111-1111-1111-111111111111', 'a7222222-2222-2222-2222-222222222222', '__tl_product');
insert into public.ads (id, org_id, brand_id, product_id, mode) values
  ('a7444444-4444-4444-4444-444444444444', 'a7111111-1111-1111-1111-111111111111', 'a7222222-2222-2222-2222-222222222222', 'a7333333-3333-3333-3333-333333333333', 'studio');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- No timeline yet.
select throws_ok(
  $$ select public.request_ad_render('a7444444-4444-4444-4444-444444444444', 'mp4', null) $$,
  'start an edit first',
  'nothing to render without a timeline'
);
select throws_ok(
  $$ select public.request_auto_edit_revision_for_ad('a7444444-4444-4444-4444-444444444444', 'make it punchier') $$,
  'start an edit first',
  'nothing to revise without a timeline'
);

-- "Start from the scenes".
select throws_ok(
  $$ select public.create_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[]}'::jsonb, 'fancy', '{}'::jsonb) $$,
  'invalid mode',
  'only designed and clean are modes'
);
select is(
  (select version from public.create_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[1]}'::jsonb, 'clean', '{"0":6.04}'::jsonb)),
  1,
  'the owner can start a timeline from the scenes'
);
select throws_ok(
  $$ select public.create_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[]}'::jsonb, 'clean', '{}'::jsonb) $$,
  'timeline_conflict: this ad already has a timeline',
  'an ad has one timeline'
);

-- Saves.
select is(
  (select version from public.save_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[2]}'::jsonb, 1)),
  2,
  'a save at the current version goes through and bumps it'
);
select throws_ok(
  $$ select public.save_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[3]}'::jsonb, 1) $$,
  'timeline_conflict: the timeline changed in another tab or by Auto-edit',
  'a save from a stale version is refused'
);
select throws_ok(
  $$ select public.save_ad_timeline('a7444444-4444-4444-4444-444444444444', '[1,2]'::jsonb, 2) $$,
  'invalid timeline',
  'a timeline is a JSON object'
);
select throws_ok(
  $$ update public.ad_timelines set version = 99 where ad_id = 'a7444444-4444-4444-4444-444444444444' $$,
  '42501',
  null,
  'the browser cannot write the timeline directly'
);
select throws_ok(
  $$ select public.assert_ad_editable('a7444444-4444-4444-4444-444444444444') $$,
  '42501',
  null,
  'the internal access check is not callable from the browser'
);

-- A revision chat turn snapshots the timeline and locks it.
select is(
  (select base_version from public.request_auto_edit_revision_for_ad('a7444444-4444-4444-4444-444444444444', 'make it punchier')),
  2,
  'a revision snapshots the timeline version it works on'
);
select is(
  (select base_plan from public.auto_edit_runs where ad_id = 'a7444444-4444-4444-4444-444444444444'),
  '{"clips":[2]}'::jsonb,
  'a revision carries the timeline as it is, manual edits included'
);
select throws_ok(
  $$ select public.save_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[4]}'::jsonb, 2) $$,
  'timeline_locked: an Auto-edit is working on this timeline',
  'manual saves wait while Auto-edit works on the timeline'
);

-- Renders.
select is(
  (select timeline_version from public.request_ad_render('a7444444-4444-4444-4444-444444444444', 'mp4', null)),
  2,
  'Render MP4 snapshots the saved timeline'
);
select throws_ok(
  $$ select public.request_ad_render('a7444444-4444-4444-4444-444444444444', 'export', 'premiere') $$,
  'a render is already running for this ad',
  'one render job per ad at a time'
);
select throws_ok(
  $$ insert into public.ad_renders (org_id, brand_id, ad_id, kind, plan, mode, timeline_version) values ('a7111111-1111-1111-1111-111111111111', 'a7222222-2222-2222-2222-222222222222', 'a7444444-4444-4444-4444-444444444444', 'mp4', '{}'::jsonb, 'clean', 1) $$,
  '42501',
  null,
  'the browser cannot insert renders directly'
);

-- The worker finishes both jobs (service role); an earlier cut is put back.
reset role;
update public.auto_edit_runs set status = 'succeeded', plan = '{"clips":[9]}'::jsonb, findings = '[{"problem":"x","fix":"y"}]'::jsonb
where ad_id = 'a7444444-4444-4444-4444-444444444444';
update public.ad_renders set status = 'succeeded' where ad_id = 'a7444444-4444-4444-4444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.request_ad_render('a7444444-4444-4444-4444-444444444444', 'export', 'avid') $$,
  'invalid export format',
  'only the listed export formats'
);
select lives_ok(
  $$ select public.request_ad_render('a7444444-4444-4444-4444-444444444444', 'export', 'resolve') $$,
  'an export can start once the render finished'
);
select is(
  (select plan from public.restore_auto_edit_cut((select id from public.auto_edit_runs where ad_id = 'a7444444-4444-4444-4444-444444444444'))),
  '{"clips":[9]}'::jsonb,
  'a finished cut can be put back on the timeline'
);

-- Another agency.
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ad_timelines where ad_id = 'a7444444-4444-4444-4444-444444444444')
    + (select count(*)::int from public.ad_renders where ad_id = 'a7444444-4444-4444-4444-444444444444'),
  0,
  'another agency sees neither the timeline nor the renders'
);
select throws_ok(
  $$ select public.save_ad_timeline('a7444444-4444-4444-4444-444444444444', '{"clips":[]}'::jsonb, 3) $$,
  'you don''t have access to this ad',
  'another agency cannot save the timeline'
);
select throws_ok(
  $$ select public.restore_auto_edit_cut((select id from public.auto_edit_runs where ad_id = 'a7444444-4444-4444-4444-444444444444')) $$,
  'Auto-edit run not found',
  'another agency cannot restore a cut'
);

select * from finish();
rollback;
