-- Task board from migration 56: default columns seed once; owners/admins
-- create tasks; tasks go only to users assigned to the task's brand; a
-- user sees and moves only their own tasks and can't edit or create
-- tasks or change columns; removing a column re-homes its tasks.

begin;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'board-admin@example.invalid', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'board-user1@example.invalid', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', 'board-user2@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name, seat_cap)
values ('a1111111-1111-1111-1111-111111111111', '__test_org_task_board', 10);

insert into public.org_members (org_id, user_id, role) values
  ('a1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'admin'),
  ('a1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'editor'),
  ('a1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003', 'editor');

insert into public.brands (id, org_id, name)
values ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', '__board_brand');

insert into public.brand_assignments (brand_id, user_id, org_id)
values ('a2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000002', 'a1111111-1111-1111-1111-111111111111');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select public.ensure_task_columns('a1111111-1111-1111-1111-111111111111');
select public.ensure_task_columns('a1111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111'),
  6,
  'default columns are seeded exactly once'
);

select lives_ok(
  $$ insert into public.tasks (id, org_id, column_id, title, brand_id, assignee_id)
     select 'a3333333-3333-3333-3333-333333333331', org_id, id, 'user1 task', 'a2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000002'
     from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'todo' $$,
  'admin can create a task for an assigned user'
);
select lives_ok(
  $$ insert into public.tasks (id, org_id, column_id, title, assignee_id)
     select 'a3333333-3333-3333-3333-333333333332', org_id, id, 'user2 task', 'a0000000-0000-0000-0000-000000000003'
     from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'todo' $$,
  'admin can create a task with no brand'
);
select throws_ok(
  $$ insert into public.tasks (org_id, column_id, title, brand_id, assignee_id)
     select org_id, id, 'bad', 'a2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000003'
     from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'todo' $$,
  'assign this user to the brand before giving them a task for it',
  'a task can''t go to a user who isn''t on its brand'
);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.tasks where org_id = 'a1111111-1111-1111-1111-111111111111'),
  1,
  'a user sees only their own tasks'
);
select lives_ok(
  $$ select public.move_task('a3333333-3333-3333-3333-333333333331',
       (select id from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'in_review'), 1) $$,
  'a user can move their own task'
);
select throws_ok(
  $$ select public.move_task('a3333333-3333-3333-3333-333333333332',
       (select id from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'in_review'), 1) $$,
  'you can only move tasks assigned to you',
  'a user cannot move someone else''s task'
);
select is_empty(
  $$ update public.tasks set title = 'x' where id = 'a3333333-3333-3333-3333-333333333331' returning id $$,
  'a user cannot edit a task directly'
);
select throws_ok(
  $$ select public.archive_task_column((select id from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'done')) $$,
  'only an owner or admin can change the board',
  'a user cannot remove columns'
);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.archive_task_column((select id from public.task_columns where org_id = 'a1111111-1111-1111-1111-111111111111' and stage = 'in_review'));
select is(
  (select count(*)::int from public.tasks t join public.task_columns c on c.id = t.column_id
   where t.org_id = 'a1111111-1111-1111-1111-111111111111' and c.archived),
  0,
  'removing a column moves its tasks to another column'
);

reset role;
select * from finish();
rollback;
