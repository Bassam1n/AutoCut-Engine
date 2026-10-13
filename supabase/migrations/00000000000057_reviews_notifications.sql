-- M3: review rounds, revisions and in-app notifications.
--
-- Flow:
--   1. A task is linked to an ad (link_task_ad: the assignee or an
--      owner/admin).
--   2. Moving the task into the "In review" stage opens a review round
--      and notifies the org's owners and admins (trigger).
--   3. An owner/admin reviews each scene (approve / request changes +
--      comment) and submits (submit_review). Any requested change moves
--      the task to "Revisions" and notifies the assignee; all approved
--      moves it to "Done" and tells the assignee.
--   4. The editor revises and moves the task back to In review, which
--      opens round N+1. Every round's notes are kept.

alter table public.tasks add column ad_id uuid references public.ads (id);

-- validate_task gains the ad check: same org, and the ad's brand must
-- match the task's brand when both are set.
create or replace function public.validate_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  ad_brand uuid;
begin
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

  if new.ad_id is not null
     and (is_insert or new.ad_id is distinct from old.ad_id or new.brand_id is distinct from old.brand_id) then
    select brand_id into ad_brand from public.ads where id = new.ad_id and org_id = new.org_id;
    if ad_brand is null then
      raise exception 'that ad doesn''t belong to this org';
    end if;
    if new.brand_id is not null and ad_brand <> new.brand_id then
      raise exception 'the ad must belong to the task''s brand';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------

create table public.review_rounds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  task_id uuid not null references public.tasks (id),
  ad_id uuid references public.ads (id),
  round_no integer not null,
  status text not null default 'open' check (status in ('open', 'changes_requested', 'approved')),
  overall_note text check (overall_note is null or char_length(overall_note) <= 5000),
  submitted_by uuid references auth.users (id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  unique (task_id, round_no)
);

create index review_rounds_ad_idx on public.review_rounds (ad_id, round_no desc);

create table public.scene_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  round_id uuid not null references public.review_rounds (id),
  scene_id uuid not null references public.scenes (id),
  verdict text not null check (verdict in ('approved', 'changes')),
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  unique (round_id, scene_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  user_id uuid not null references auth.users (id),
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.review_rounds enable row level security;
alter table public.scene_reviews enable row level security;
alter table public.notifications enable row level security;

-- Owners/admins see every round; the task's assignee sees their own.
create policy review_rounds_select on public.review_rounds
  for select using (
    public.is_org_admin(org_id)
    or exists (
      select 1 from public.tasks t
      where t.id = review_rounds.task_id and t.assignee_id = auth.uid() and public.is_org_member(t.org_id)
    )
  );

-- Scene comments follow the round's visibility.
create policy scene_reviews_select on public.scene_reviews
  for select using (
    exists (select 1 from public.review_rounds r where r.id = scene_reviews.round_id)
  );

create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------

-- Relative link to an ad's studio page.
create or replace function public.ad_link(target_ad_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select '/org/' || a.org_id || '/brands/' || a.brand_id || '/products/' || a.product_id || '/ads/' || a.id
  from public.ads a
  where a.id = target_ad_id;
$$;

create or replace function public.notify_org_admins(
  target_org_id uuid,
  notification_kind text,
  notification_title text,
  notification_body text,
  notification_link text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (org_id, user_id, kind, title, body, link)
  select target_org_id, m.user_id, notification_kind, notification_title, notification_body, notification_link
  from public.org_members m
  where m.org_id = target_org_id and m.role in ('owner', 'admin') and m.seat_active;
$$;

-- ---------------------------------------------------------------
-- Stage changes: open rounds and notify.
-- ---------------------------------------------------------------

create or replace function public.on_task_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_stage text;
  old_stage text;
  next_round integer;
  round_id uuid;
  latest_status text;
begin
  select stage into new_stage from public.task_columns where id = new.column_id;
  if tg_op = 'UPDATE' then
    select stage into old_stage from public.task_columns where id = old.column_id;
  end if;

  if new_stage is not distinct from old_stage then
    return new;
  end if;

  if new_stage = 'in_review' then
    -- One open round at a time per task.
    if not exists (select 1 from public.review_rounds where task_id = new.id and status = 'open') then
      select coalesce(max(round_no), 0) + 1 into next_round from public.review_rounds where task_id = new.id;

      insert into public.review_rounds (org_id, task_id, ad_id, round_no, submitted_by)
      values (new.org_id, new.id, new.ad_id, next_round, auth.uid())
      returning id into round_id;

      perform public.notify_org_admins(
        new.org_id,
        'review_requested',
        'Ready for review: ' || new.title,
        case when next_round > 1 then 'Revision round ' || next_round else null end,
        '/org/' || new.org_id || '/review/' || round_id
      );
    end if;
  elsif new.assignee_id is not null and new_stage in ('revisions', 'done') then
    select status into latest_status
    from public.review_rounds where task_id = new.id
    order by round_no desc limit 1;

    if new_stage = 'revisions' then
      insert into public.notifications (org_id, user_id, kind, title, body, link)
      values (
        new.org_id, new.assignee_id, 'changes_requested',
        'Changes requested: ' || new.title,
        null,
        coalesce(public.ad_link(new.ad_id), '/org/' || new.org_id || '/tasks')
      );
    elsif latest_status = 'approved' then
      insert into public.notifications (org_id, user_id, kind, title, body, link)
      values (
        new.org_id, new.assignee_id, 'approved',
        'Approved: ' || new.title,
        null,
        '/org/' || new.org_id || '/tasks'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_stage_change
  after insert or update of column_id on public.tasks
  for each row execute function public.on_task_stage_change();

-- ---------------------------------------------------------------
-- RPCs.
-- ---------------------------------------------------------------

-- Assignee or owner/admin links (or unlinks, with null) the ad this task produces.
create or replace function public.link_task_ad(target_task_id uuid, target_ad_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks;
  ad_row public.ads;
begin
  select * into task_row from public.tasks where id = target_task_id and not archived;
  if task_row.id is null then
    raise exception 'task not found';
  end if;

  if not (
    public.is_org_admin(task_row.org_id)
    or (public.is_org_member(task_row.org_id) and task_row.assignee_id = auth.uid())
  ) then
    raise exception 'you can only link ads to your own tasks';
  end if;

  if target_ad_id is not null then
    select * into ad_row from public.ads where id = target_ad_id and org_id = task_row.org_id;
    if ad_row.id is null or not public.has_brand_access(ad_row.org_id, ad_row.brand_id) then
      raise exception 'ad not found';
    end if;
  end if;

  update public.tasks set ad_id = target_ad_id where id = target_task_id returning * into task_row;

  -- An open round picks up the newly linked ad.
  update public.review_rounds set ad_id = target_ad_id
  where task_id = target_task_id and status = 'open';

  return task_row;
end;
$$;

-- Owner/admin submits a review. verdicts: [{scene_id, verdict, comment}].
-- Any 'changes' verdict sends the task to Revisions; otherwise to Done.
create or replace function public.submit_review(
  target_round_id uuid,
  review_note text,
  verdicts jsonb
)
returns public.review_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.review_rounds;
  has_changes boolean;
  target_stage text;
  target_column uuid;
begin
  select * into round_row from public.review_rounds where id = target_round_id;
  if round_row.id is null then
    raise exception 'review not found';
  end if;

  if not public.is_org_admin(round_row.org_id) then
    raise exception 'only an owner or admin can review';
  end if;

  if round_row.status <> 'open' then
    raise exception 'this review round has already been submitted';
  end if;

  if jsonb_typeof(coalesce(verdicts, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid verdicts';
  end if;

  insert into public.scene_reviews (org_id, round_id, scene_id, verdict, comment)
  select round_row.org_id, round_row.id, s.id, v.verdict, nullif(trim(v.comment), '')
  from jsonb_to_recordset(coalesce(verdicts, '[]'::jsonb)) as v(scene_id uuid, verdict text, comment text)
  join public.scenes s on s.id = v.scene_id and s.ad_id = round_row.ad_id;

  select exists (
    select 1 from public.scene_reviews where round_id = round_row.id and verdict = 'changes'
  ) into has_changes;

  -- An overall note with no scene approvals still counts as a request for changes.
  if not has_changes and nullif(trim(coalesce(review_note, '')), '') is not null
     and not exists (select 1 from public.scene_reviews where round_id = round_row.id) then
    has_changes := true;
  end if;

  update public.review_rounds
  set status = case when has_changes then 'changes_requested' else 'approved' end,
      overall_note = nullif(trim(coalesce(review_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = round_row.id
  returning * into round_row;

  target_stage := case when has_changes then 'revisions' else 'done' end;
  select id into target_column
  from public.task_columns
  where org_id = round_row.org_id and stage = target_stage and not archived
  limit 1;

  if target_column is not null then
    update public.tasks set column_id = target_column where id = round_row.task_id;
  end if;

  return round_row;
end;
$$;

create or replace function public.mark_notifications_read(notification_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (notification_ids is null or id = any (notification_ids));
$$;

-- ---------------------------------------------------------------
-- Slack: one incoming-webhook URL per org, kept in Vault like the
-- provider keys. Owner saves it; only the service role reads it back.
-- (org_secrets' provider CHECK doesn't include Slack, hence its own table.)
-- ---------------------------------------------------------------

create table public.org_slack (
  org_id uuid primary key references public.orgs (id),
  vault_secret_id uuid,
  updated_at timestamptz not null default now()
);

-- No policies: reached only through the functions below.
alter table public.org_slack enable row level security;

create or replace function public.save_slack_webhook(target_org_id uuid, webhook_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_vault_id uuid;
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner can connect Slack';
  end if;

  select vault_secret_id into existing_vault_id from public.org_slack where org_id = target_org_id;

  if webhook_url is null or trim(webhook_url) = '' then
    update public.org_slack set vault_secret_id = null, updated_at = now() where org_id = target_org_id;
    insert into public.audit_log (org_id, actor, action, target)
    values (target_org_id, auth.uid(), 'slack_disconnected', null);
    return;
  end if;

  if webhook_url !~ '^https://hooks\.slack\.com/' then
    raise exception 'that doesn''t look like a Slack incoming webhook URL';
  end if;

  if existing_vault_id is not null then
    perform vault.update_secret(existing_vault_id, webhook_url);
  else
    existing_vault_id := vault.create_secret(webhook_url, 'org_slack:' || target_org_id::text || ':' || gen_random_uuid()::text);
  end if;

  insert into public.org_slack (org_id, vault_secret_id, updated_at)
  values (target_org_id, existing_vault_id, now())
  on conflict (org_id) do update set vault_secret_id = excluded.vault_secret_id, updated_at = now();

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'slack_connected', null);
end;
$$;

create or replace function public.slack_connected(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org_id)
    and exists (select 1 from public.org_slack where org_id = target_org_id and vault_secret_id is not null);
$$;

create or replace function public.get_slack_webhook(target_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  url text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'get_slack_webhook can only be called by the service role';
  end if;

  select ds.decrypted_secret into url
  from public.org_slack s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = target_org_id;

  return url;
end;
$$;
