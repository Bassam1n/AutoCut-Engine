-- M3: task board.
--
-- Per-org columns (default To do / In progress / In review / Done /
-- Delivered / Revisions, renamable, reorderable, removable by owners
-- and admins). Columns carry an optional `stage` so the review flow
-- (step 5) can still find "In review" / "Revisions" after a rename.
--
-- Tasks: owners/admins create, edit and see every task; a user
-- (editor) sees only tasks assigned to them and can move their own
-- tasks between columns (move_task). Nothing is hard-deleted: columns
-- and tasks are archived.

create table public.task_columns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  name text not null check (char_length(name) between 1 and 40),
  position integer not null,
  stage text check (stage in ('todo', 'in_progress', 'in_review', 'done', 'delivered', 'revisions')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index task_columns_org_stage_idx on public.task_columns (org_id, stage)
  where stage is not null and not archived;
create index task_columns_org_idx on public.task_columns (org_id, position) where not archived;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  column_id uuid not null references public.task_columns (id),
  position double precision not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  brand_id uuid references public.brands (id),
  assignee_id uuid references auth.users (id),
  due_date date,
  archived boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_org_column_idx on public.tasks (org_id, column_id, position) where not archived;
create index tasks_assignee_idx on public.tasks (assignee_id) where not archived;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.task_columns enable row level security;
alter table public.tasks enable row level security;

create policy task_columns_select on public.task_columns
  for select using (public.is_org_member(org_id));
create policy task_columns_insert on public.task_columns
  for insert with check (public.is_org_admin(org_id));
create policy task_columns_update on public.task_columns
  for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy tasks_select on public.tasks
  for select using (
    public.is_org_admin(org_id)
    or (public.is_org_member(org_id) and assignee_id = auth.uid())
  );
create policy tasks_insert on public.tasks
  for insert with check (public.is_org_admin(org_id));
create policy tasks_update on public.tasks
  for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Keeps every task consistent no matter who writes it: the column and
-- brand belong to the task's org, and the assignee is an active user
-- (editor) of that org who is assigned to the task's brand.
create or replace function public.validate_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_insert boolean := tg_op = 'INSERT';
begin
  -- Each check runs only when its field is set or changed, so moving or
  -- renaming a task isn't blocked by, say, its assignee having since
  -- been deactivated.
  if is_insert or new.column_id is distinct from old.column_id then
    if not exists (
      select 1 from public.task_columns c
      where c.id = new.column_id and c.org_id = new.org_id and not c.archived
    ) then
      raise exception 'that column doesn''t exist on this board';
    end if;
  end if;

  if new.brand_id is not null and (is_insert or new.brand_id is distinct from old.brand_id) then
    if not exists (select 1 from public.brands b where b.id = new.brand_id and b.org_id = new.org_id) then
      raise exception 'brand does not belong to this org';
    end if;
  end if;

  if new.assignee_id is not null
     and (is_insert or new.assignee_id is distinct from old.assignee_id or new.brand_id is distinct from old.brand_id) then
    if not exists (
      select 1 from public.org_members m
      where m.org_id = new.org_id and m.user_id = new.assignee_id
        and m.role = 'editor' and m.seat_active
    ) then
      raise exception 'tasks can only be assigned to users on this team';
    end if;

    if new.brand_id is not null and not exists (
      select 1 from public.brand_assignments ba
      where ba.brand_id = new.brand_id and ba.user_id = new.assignee_id and ba.active
    ) then
      raise exception 'assign this user to the brand before giving them a task for it';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_validate
  before insert or update on public.tasks
  for each row execute function public.validate_task();

-- Seeds the default columns the first time anyone opens the board.
-- Callable by any member (a user's My tasks view needs columns too),
-- but it only ever inserts the defaults into an org that has none.
create or replace function public.ensure_task_columns(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org_id) then
    raise exception 'not a member of this org';
  end if;

  if exists (select 1 from public.task_columns where org_id = target_org_id) then
    return;
  end if;

  insert into public.task_columns (org_id, name, position, stage) values
    (target_org_id, 'To do', 0, 'todo'),
    (target_org_id, 'In progress', 1, 'in_progress'),
    (target_org_id, 'In review', 2, 'in_review'),
    (target_org_id, 'Done', 3, 'done'),
    (target_org_id, 'Delivered', 4, 'delivered'),
    (target_org_id, 'Revisions', 5, 'revisions');
end;
$$;

-- Moves a task to a column/position. Owners/admins can move any task;
-- a user can move only tasks assigned to them.
create or replace function public.move_task(
  target_task_id uuid,
  target_column_id uuid,
  target_position double precision
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks;
begin
  select * into task_row from public.tasks where id = target_task_id and not archived;
  if task_row.id is null then
    raise exception 'task not found';
  end if;

  if not (
    public.is_org_admin(task_row.org_id)
    or (public.is_org_member(task_row.org_id) and task_row.assignee_id = auth.uid())
  ) then
    raise exception 'you can only move tasks assigned to you';
  end if;

  update public.tasks
  set column_id = target_column_id, position = target_position
  where id = target_task_id
  returning * into task_row;

  return task_row;
end;
$$;

-- Removes a column from the board: its tasks move to the first
-- remaining column. Owners/admins only, and the last column stays.
create or replace function public.archive_task_column(target_column_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  col public.task_columns;
  fallback_id uuid;
begin
  select * into col from public.task_columns where id = target_column_id and not archived;
  if col.id is null then
    raise exception 'column not found';
  end if;

  if not public.is_org_admin(col.org_id) then
    raise exception 'only an owner or admin can change the board';
  end if;

  select id into fallback_id
  from public.task_columns
  where org_id = col.org_id and not archived and id <> col.id
  order by position
  limit 1;

  if fallback_id is null then
    raise exception 'a board needs at least one column';
  end if;

  update public.task_columns set archived = true where id = col.id;

  update public.tasks set column_id = fallback_id
  where column_id = col.id and not archived;
end;
$$;
