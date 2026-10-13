-- Review rounds and notifications from migration 57: moving a task into
-- In review opens a round and notifies admins; only owners/admins can
-- submit a review; requested changes send the task to Revisions and
-- notify the assignee, who can read the scene comments; approval moves
-- it to Done; a round can't be submitted twice.

begin;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-0000-0000-000000000001', 'review-admin@example.invalid', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'review-user@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap) values ('b1111111-1111-1111-1111-111111111111', '__test_org_reviews', 10);
insert into public.org_members (org_id, user_id, role) values
  ('b1111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 'admin'),
  ('b1111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', 'editor');
insert into public.brands (id, org_id, name) values ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111', '__review_brand');
insert into public.brand_assignments (brand_id, user_id, org_id) values
  ('b2222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111111');
insert into public.products (id, org_id, brand_id, name) values
  ('b3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', '__p');
insert into public.ads (id, org_id, brand_id, product_id, mode) values
  ('b4444444-4444-4444-4444-444444444444', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'b3333333-3333-3333-3333-333333333333', 'studio');
insert into public.scenes (id, org_id, ad_id, idx) values
  ('b5555555-5555-5555-5555-555555555551', 'b1111111-1111-1111-1111-111111111111', 'b4444444-4444-4444-4444-444444444444', 0);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.ensure_task_columns('b1111111-1111-1111-1111-111111111111');
insert into public.tasks (id, org_id, column_id, title, brand_id, assignee_id, ad_id)
select 'b6666666-6666-6666-6666-666666666666', org_id, id, '__review task',
       'b2222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000002', 'b4444444-4444-4444-4444-444444444444'
from public.task_columns where org_id = 'b1111111-1111-1111-1111-111111111111' and stage = 'todo';

-- User submits for review.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.move_task('b6666666-6666-6666-6666-666666666666',
  (select id from public.task_columns where org_id = 'b1111111-1111-1111-1111-111111111111' and stage = 'in_review'), 1);

select is(
  (select count(*)::int from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666' and status = 'open'),
  1,
  'moving to In review opens a round'
);
select throws_ok(
  $$ select public.submit_review((select id from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666'), null, '[]') $$,
  'only an owner or admin can review',
  'a user cannot submit a review'
);

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.notifications where user_id = 'b0000000-0000-0000-0000-000000000001' and kind = 'review_requested'),
  1,
  'admins are notified of a review request'
);
select public.submit_review(
  (select id from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666' and round_no = 1),
  null,
  '[{"scene_id":"b5555555-5555-5555-5555-555555555551","verdict":"changes","comment":"Bigger bottle"}]'
);
select is(
  (select c.stage from public.tasks t join public.task_columns c on c.id = t.column_id where t.id = 'b6666666-6666-6666-6666-666666666666'),
  'revisions',
  'requested changes move the task to Revisions'
);
select throws_ok(
  $$ select public.submit_review((select id from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666' and round_no = 1), null, '[]') $$,
  'this review round has already been submitted',
  'a round cannot be submitted twice'
);

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.notifications where user_id = 'b0000000-0000-0000-0000-000000000002' and kind = 'changes_requested'),
  1,
  'the assignee is notified of requested changes'
);
select is(
  (select comment from public.scene_reviews where scene_id = 'b5555555-5555-5555-5555-555555555551'),
  'Bigger bottle',
  'the assignee can read the scene comment'
);

-- Resubmit and approve.
select public.move_task('b6666666-6666-6666-6666-666666666666',
  (select id from public.task_columns where org_id = 'b1111111-1111-1111-1111-111111111111' and stage = 'in_review'), 1);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select round_no from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666' and status = 'open'),
  2,
  'resubmitting opens round 2'
);
select public.submit_review(
  (select id from public.review_rounds where task_id = 'b6666666-6666-6666-6666-666666666666' and round_no = 2),
  null,
  '[{"scene_id":"b5555555-5555-5555-5555-555555555551","verdict":"approved"}]'
);
select is(
  (select c.stage from public.tasks t join public.task_columns c on c.id = t.column_id where t.id = 'b6666666-6666-6666-6666-666666666666'),
  'done',
  'approving everything moves the task to Done'
);

reset role;
select * from finish();
rollback;
