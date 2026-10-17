-- Auto-edit: Claude edits an ad's finished scene videos into a final
-- 1080x1920 MP4 on a dedicated Trigger.dev render worker.
--
-- One row per run. A first edit is kind 'edit'; each revision chat turn
-- is a new 'revision' row pointing at the run it revises, so every cut
-- and its plan stay on record. The plan is stored between pipeline
-- steps (plan -> graphics + preview -> review -> fix -> final), so a
-- failed render retries without paying Claude again.
--
-- Written only by the service role (the worker) and by the two
-- SECURITY DEFINER request functions below, which check the caller in
-- their body. Read with the same brand scope as every other ad table.
-- Applied in chunks through the Supabase MCP; this file is the record.

alter table public.brands add column auto_edit_mode text
  check (auto_edit_mode is null or auto_edit_mode in ('designed', 'clean'));
comment on column public.brands.auto_edit_mode is
  'The Auto-edit mode this brand''s editors last chose; the export step preselects it (null: designed).';

create table public.auto_edit_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  parent_run_id uuid references public.auto_edit_runs(id) on delete set null,
  kind text not null check (kind in ('edit', 'revision')),
  mode text not null check (mode in ('designed', 'clean')),
  status text not null default 'queued' check (status in (
    'queued', 'planning', 'rendering_preview', 'reviewing', 'fixing', 'rendering_final',
    'succeeded', 'failed', 'cancelled'
  )),
  instruction text check (instruction is null or char_length(instruction) <= 2000),
  -- The plan as Claude first wrote it, and the plan that was rendered
  -- last (after the review fix, if any).
  initial_plan jsonb,
  plan jsonb,
  review jsonb,
  -- Review findings that still hold for this cut: this run's own plus
  -- every ancestor's. Sent with each revision so a revision never
  -- undoes a fix it can't see the reason for.
  findings jsonb not null default '[]'::jsonb,
  -- Per graphic: designed or template, and why a designed one fell back.
  graphics jsonb not null default '[]'::jsonb,
  preview_asset_id uuid references public.assets(id) on delete set null,
  final_asset_id uuid references public.assets(id) on delete set null,
  claude_usd numeric not null default 0,
  claude_calls jsonb not null default '[]'::jsonb,
  timings jsonb not null default '{}'::jsonb,
  machine text,
  trigger_run_id text,
  error_code text,
  error text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint auto_edit_runs_revision_has_parent check (kind = 'edit' or (parent_run_id is not null and instruction is not null))
);

create index auto_edit_runs_ad_idx on public.auto_edit_runs (ad_id, created_at desc);
create index auto_edit_runs_org_status_idx on public.auto_edit_runs (org_id, status);

create trigger auto_edit_runs_set_updated_at
  before update on public.auto_edit_runs
  for each row execute function public.set_updated_at();

alter table public.auto_edit_runs enable row level security;

create policy auto_edit_runs_select on public.auto_edit_runs
  for select using (public.has_scope_access(org_id, brand_id, ad_id));

-- No insert/update/delete policies: the browser never writes this table.
revoke insert, update, delete on public.auto_edit_runs from anon, authenticated;

-- ---------------------------------------------------------------
-- A run whose worker was killed (past its time limit, or the machine
-- went away) never reports back. Anything active with no update for 45
-- minutes (the task's own limit is 30) is marked failed, so it can't
-- block the ad's next Auto-edit. Called by the request functions.
-- ---------------------------------------------------------------
create or replace function public.expire_stalled_auto_edits(target_ad_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.auto_edit_runs
  set status = 'failed', error_code = 'RENDER_FAILED', error = 'The render worker stopped responding.', finished_at = now()
  where ad_id = target_ad_id
    and status not in ('succeeded', 'failed', 'cancelled')
    and updated_at < now() - interval '45 minutes';
$$;
revoke execute on function public.expire_stalled_auto_edits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- request_auto_edit: a first edit of an ad.
-- ---------------------------------------------------------------
create or replace function public.request_auto_edit(target_ad_id uuid, edit_mode text)
returns public.auto_edit_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
  new_run public.auto_edit_runs;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if edit_mode is null or edit_mode not in ('designed', 'clean') then
    raise exception 'invalid mode';
  end if;
  select * into ad_row from public.ads where id = target_ad_id;
  if ad_row.id is null or not public.has_scope_access(ad_row.org_id, ad_row.brand_id, ad_row.id) then
    raise exception 'you don''t have access to this ad';
  end if;
  if ad_row.archived then
    raise exception 'this ad is archived';
  end if;
  if not exists (select 1 from public.brands b where b.id = ad_row.brand_id and b.org_id = ad_row.org_id and b.active) then
    raise exception 'brand_archived: this brand is archived';
  end if;
  perform public.expire_stalled_auto_edits(ad_row.id);
  if exists (
    select 1 from public.auto_edit_runs r
    where r.ad_id = ad_row.id and r.status not in ('succeeded', 'failed', 'cancelled')
  ) then
    raise exception 'an Auto-edit is already running for this ad';
  end if;

  insert into public.auto_edit_runs (org_id, brand_id, ad_id, kind, mode, requested_by)
  values (ad_row.org_id, ad_row.brand_id, ad_row.id, 'edit', edit_mode, auth.uid())
  returning * into new_run;

  -- Remember the brand's choice for next time.
  update public.brands set auto_edit_mode = edit_mode
  where id = ad_row.brand_id and auto_edit_mode is distinct from edit_mode;

  return new_run;
end;
$$;
revoke execute on function public.request_auto_edit(uuid, text) from public, anon;
grant execute on function public.request_auto_edit(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- request_auto_edit_revision: a revision chat turn on a finished cut.
-- ---------------------------------------------------------------
create or replace function public.request_auto_edit_revision(target_run_id uuid, revision_instruction text)
returns public.auto_edit_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  parent public.auto_edit_runs;
  ad_row public.ads;
  clean_instruction text := nullif(trim(coalesce(revision_instruction, '')), '');
  new_run public.auto_edit_runs;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if clean_instruction is null then
    raise exception 'say what to change';
  end if;
  if char_length(clean_instruction) > 2000 then
    raise exception 'keep the request under 2000 characters';
  end if;
  select * into parent from public.auto_edit_runs where id = target_run_id;
  if parent.id is null or not public.has_scope_access(parent.org_id, parent.brand_id, parent.ad_id) then
    raise exception 'Auto-edit run not found';
  end if;
  if parent.status <> 'succeeded' or parent.plan is null then
    raise exception 'only a finished cut can be revised';
  end if;
  select * into ad_row from public.ads where id = parent.ad_id;
  if ad_row.archived then
    raise exception 'this ad is archived';
  end if;
  if not exists (select 1 from public.brands b where b.id = parent.brand_id and b.org_id = parent.org_id and b.active) then
    raise exception 'brand_archived: this brand is archived';
  end if;
  perform public.expire_stalled_auto_edits(parent.ad_id);
  if exists (
    select 1 from public.auto_edit_runs r
    where r.ad_id = parent.ad_id and r.status not in ('succeeded', 'failed', 'cancelled')
  ) then
    raise exception 'an Auto-edit is already running for this ad';
  end if;

  insert into public.auto_edit_runs (org_id, brand_id, ad_id, parent_run_id, kind, mode, instruction, findings, requested_by)
  values (parent.org_id, parent.brand_id, parent.ad_id, parent.id, 'revision', parent.mode, clean_instruction, parent.findings, auth.uid())
  returning * into new_run;
  return new_run;
end;
$$;
revoke execute on function public.request_auto_edit_revision(uuid, text) from public, anon;
grant execute on function public.request_auto_edit_revision(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- How many renders are executing, for the "queued" message. Counts
-- across agencies, so it returns only a number.
-- ---------------------------------------------------------------
create or replace function public.auto_edit_queue_position(target_run_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  run_row public.auto_edit_runs;
begin
  select * into run_row from public.auto_edit_runs where id = target_run_id;
  if run_row.id is null or not (auth.role() = 'service_role' or public.has_scope_access(run_row.org_id, run_row.brand_id, run_row.ad_id)) then
    raise exception 'Auto-edit run not found';
  end if;
  if run_row.status <> 'queued' then
    return 0;
  end if;
  return (
    select count(*)::int from public.auto_edit_runs r
    where r.status = 'queued' and r.created_at < run_row.created_at
  ) + 1;
end;
$$;
revoke execute on function public.auto_edit_queue_position(uuid) from public, anon;
grant execute on function public.auto_edit_queue_position(uuid) to authenticated, service_role;
