-- Auto-edit (migration 68): runs are created only through
-- request_auto_edit / request_auto_edit_revision, which check brand
-- access in their body; the browser can read its brand's runs and can't
-- write the table; one run per ad at a time; a revision needs a
-- finished cut and carries its findings; a stalled run stops blocking.

begin;
select plan(15);

insert into auth.users (id, email, aud, role) values
  ('ae000000-0000-0000-0000-000000000001', 'ae-owner@example.invalid', 'authenticated', 'authenticated'),
  ('ae000000-0000-0000-0000-000000000002', 'ae-editor@example.invalid', 'authenticated', 'authenticated'),
  ('ae000000-0000-0000-0000-000000000003', 'ae-other-org@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap) values
  ('ae111111-1111-1111-1111-111111111111', '__test_auto_edit_org', 10),
  ('ae999999-9999-9999-9999-999999999999', '__test_auto_edit_other_org', 10);

insert into public.org_members (org_id, user_id, role) values
  ('ae111111-1111-1111-1111-111111111111', 'ae000000-0000-0000-0000-000000000001', 'owner'),
  ('ae111111-1111-1111-1111-111111111111', 'ae000000-0000-0000-0000-000000000002', 'editor'),
  ('ae999999-9999-9999-9999-999999999999', 'ae000000-0000-0000-0000-000000000003', 'owner');

insert into public.brands (id, org_id, name) values
  ('ae222222-2222-2222-2222-222222222222', 'ae111111-1111-1111-1111-111111111111', '__ae_brand');
insert into public.products (id, org_id, brand_id, name) values
  ('ae333333-3333-3333-3333-333333333333', 'ae111111-1111-1111-1111-111111111111', 'ae222222-2222-2222-2222-222222222222', '__ae_product');
insert into public.ads (id, org_id, brand_id, product_id, mode) values
  ('ae444444-4444-4444-4444-444444444444', 'ae111111-1111-1111-1111-111111111111', 'ae222222-2222-2222-2222-222222222222', 'ae333333-3333-3333-3333-333333333333', 'studio');

set local role authenticated;

-- The editor isn't assigned to the brand.
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'designed') $$,
  'you don''t have access to this ad',
  'an editor without the brand assignment cannot start an Auto-edit'
);

-- Another agency's owner.
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'designed') $$,
  'you don''t have access to this ad',
  'another agency cannot start an Auto-edit on this ad'
);

-- The owner.
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'fancy') $$,
  'invalid mode',
  'only designed and clean are modes'
);
select lives_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'clean') $$,
  'the owner can start an Auto-edit'
);
select is(
  (select auto_edit_mode from public.brands where id = 'ae222222-2222-2222-2222-222222222222'),
  'clean',
  'the brand remembers the last mode'
);
select throws_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'clean') $$,
  'an Auto-edit is already running for this ad',
  'one Auto-edit per ad at a time'
);
select throws_ok(
  $$ insert into public.auto_edit_runs (org_id, brand_id, ad_id, kind, mode) values ('ae111111-1111-1111-1111-111111111111', 'ae222222-2222-2222-2222-222222222222', 'ae444444-4444-4444-4444-444444444444', 'edit', 'clean') $$,
  '42501',
  null,
  'the browser cannot insert runs directly'
);
select throws_ok(
  $$ select public.request_auto_edit_revision((select id from public.auto_edit_runs where ad_id = 'ae444444-4444-4444-4444-444444444444' limit 1), 'make it punchier') $$,
  'only a finished cut can be revised',
  'a run that has not finished cannot be revised'
);
select is(
  public.auto_edit_queue_position((select id from public.auto_edit_runs where ad_id = 'ae444444-4444-4444-4444-444444444444' limit 1)) >= 1,
  true,
  'a member sees the queue position of a queued run'
);

-- The worker finishes it (service role).
reset role;
update public.auto_edit_runs
set status = 'succeeded', plan = '{"summary":"x"}'::jsonb, findings = '[{"at":12,"problem":"competitor logo","fix":"cut scene 4"}]'::jsonb
where ad_id = 'ae444444-4444-4444-4444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.request_auto_edit_revision((select id from public.auto_edit_runs where ad_id = 'ae444444-4444-4444-4444-444444444444' limit 1), '   ') $$,
  'say what to change',
  'a revision needs an instruction'
);
select lives_ok(
  $$ select public.request_auto_edit_revision((select id from public.auto_edit_runs where ad_id = 'ae444444-4444-4444-4444-444444444444' and kind = 'edit'), 'make it punchier') $$,
  'a finished cut can be revised'
);
select is(
  (select findings -> 0 ->> 'fix' from public.auto_edit_runs where kind = 'revision' and ad_id = 'ae444444-4444-4444-4444-444444444444'),
  'cut scene 4',
  'the revision carries the review findings of the cut it revises'
);

-- Another agency can't see the runs.
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.auto_edit_runs where ad_id = 'ae444444-4444-4444-4444-444444444444'),
  0,
  'runs are invisible to another agency'
);

-- A run that stopped reporting doesn't block the ad forever.
reset role;
update public.auto_edit_runs set updated_at = now() - interval '2 hours'
where kind = 'revision' and ad_id = 'ae444444-4444-4444-4444-444444444444';
alter table public.auto_edit_runs disable trigger auto_edit_runs_set_updated_at;
update public.auto_edit_runs set updated_at = now() - interval '2 hours'
where kind = 'revision' and ad_id = 'ae444444-4444-4444-4444-444444444444';
alter table public.auto_edit_runs enable trigger auto_edit_runs_set_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.request_auto_edit('ae444444-4444-4444-4444-444444444444', 'designed') $$,
  'a stalled run is expired and a new Auto-edit can start'
);
select is(
  (select status from public.auto_edit_runs where kind = 'revision' and ad_id = 'ae444444-4444-4444-4444-444444444444'),
  'failed',
  'the stalled run is marked failed'
);

select * from finish();
rollback;
