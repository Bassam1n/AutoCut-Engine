-- Auto-edit timeline editor, final renders and project exports.
--
-- ad_timelines: one editable timeline per ad. Its plan is the EditPlan the
-- web editor shows and edits; Auto-edit runs and revision chat turns
-- write their result here, and manual edits autosave here (optimistic
-- version check). The browser previews it live; nothing renders until
-- the editor asks for an MP4 or a project export.
--
-- ad_renders: "Render MP4" and "Export project for..." jobs on the render
-- worker, each against a snapshot of the timeline. Export files are
-- stored one by one (the storage upload limit is per file) and zipped in
-- the browser on download.
--
-- Written only by the service role (the worker) and by the SECURITY
-- DEFINER functions below, which check the caller in their body and are
-- revoked from PUBLIC and anon. Read with the same brand scope as every
-- other ad table. Applied in chunks through the Supabase MCP.

create table public.ad_timelines (
  ad_id uuid primary key references public.ads(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  mode text not null check (mode in ('designed', 'clean')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) < 1000000),
  -- Review findings that hold for this timeline; sent with every revision.
  findings jsonb not null default '[]'::jsonb,
  -- Seconds of each scene's clip by scene index, for the editor's trims.
  clip_durations jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  source_run_id uuid references public.auto_edit_runs(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ad_timelines_set_updated_at
  before update on public.ad_timelines
  for each row execute function public.set_updated_at();

alter table public.ad_timelines enable row level security;
create policy ad_timelines_select on public.ad_timelines
  for select using (public.has_scope_access(org_id, brand_id, ad_id));
revoke insert, update, delete on public.ad_timelines from anon, authenticated;

-- A revision chat turn revises the timeline as it stood when it was asked.
alter table public.auto_edit_runs add column base_plan jsonb;
alter table public.auto_edit_runs add column base_version integer;

create table public.ad_renders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  kind text not null check (kind in ('mp4', 'export')),
  format text check (format is null or format in ('concat', 'premiere', 'resolve', 'fcp', 'capcut')),
  plan jsonb not null,
  mode text not null check (mode in ('designed', 'clean')),
  timeline_version integer not null,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'succeeded', 'failed', 'cancelled')),
  asset_id uuid references public.assets(id) on delete set null,
  -- Export bundles: [{path, storagePath, bytes}], zipped in the browser.
  files jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  timings jsonb not null default '{}'::jsonb,
  machine text,
  trigger_run_id text,
  error_code text,
  error text,
  error_detail text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ad_renders_format_matches_kind check ((kind = 'export') = (format is not null))
);

create index ad_renders_ad_idx on public.ad_renders (ad_id, created_at desc);

create trigger ad_renders_set_updated_at
  before update on public.ad_renders
  for each row execute function public.set_updated_at();

alter table public.ad_renders enable row level security;
create policy ad_renders_select on public.ad_renders
  for select using (public.has_scope_access(org_id, brand_id, ad_id));
revoke insert, update, delete on public.ad_renders from anon, authenticated;

-- ---------------------------------------------------------------
-- Shared checks for the editor's write paths.
-- ---------------------------------------------------------------
create or replace function public.assert_ad_editable(target_ad_id uuid)
returns public.ads
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
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
  return ad_row;
end;
$$;
revoke execute on function public.assert_ad_editable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- save_ad_timeline: the editor's autosave. expected_version guards
-- against two tabs overwriting each other; a timeline is locked while an
-- Auto-edit run is working on it.
-- ---------------------------------------------------------------
create or replace function public.save_ad_timeline(target_ad_id uuid, new_plan jsonb, expected_version integer)
returns public.ad_timelines
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
  saved public.ad_timelines;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  if new_plan is null or jsonb_typeof(new_plan) <> 'object' or octet_length(new_plan::text) >= 1000000 then
    raise exception 'invalid timeline';
  end if;
  perform public.expire_stalled_auto_edits(ad_row.id);
  if exists (
    select 1 from public.auto_edit_runs r
    where r.ad_id = ad_row.id and r.status not in ('succeeded', 'failed', 'cancelled')
  ) then
    raise exception 'timeline_locked: an Auto-edit is working on this timeline';
  end if;
  update public.ad_timelines
  set plan = new_plan, version = version + 1, updated_by = auth.uid()
  where ad_id = ad_row.id and version = expected_version
  returning * into saved;
  if saved.ad_id is null then
    if exists (select 1 from public.ad_timelines where ad_id = ad_row.id) then
      raise exception 'timeline_conflict: the timeline changed in another tab or by Auto-edit';
    end if;
    raise exception 'no timeline yet';
  end if;
  return saved;
end;
$$;
revoke execute on function public.save_ad_timeline(uuid, jsonb, integer) from public, anon;
grant execute on function public.save_ad_timeline(uuid, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------
-- create_ad_timeline: "Start from the scenes", without Claude. The plan is
-- built and checked by the server action.
-- ---------------------------------------------------------------
create or replace function public.create_ad_timeline(target_ad_id uuid, new_plan jsonb, timeline_mode text, durations jsonb)
returns public.ad_timelines
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
  created public.ad_timelines;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  if timeline_mode is null or timeline_mode not in ('designed', 'clean') then
    raise exception 'invalid mode';
  end if;
  if new_plan is null or jsonb_typeof(new_plan) <> 'object' or octet_length(new_plan::text) >= 1000000 then
    raise exception 'invalid timeline';
  end if;
  insert into public.ad_timelines (ad_id, org_id, brand_id, mode, plan, clip_durations, updated_by)
  values (ad_row.id, ad_row.org_id, ad_row.brand_id, timeline_mode, new_plan, coalesce(durations, '{}'::jsonb), auth.uid())
  on conflict (ad_id) do nothing
  returning * into created;
  if created.ad_id is null then
    raise exception 'timeline_conflict: this ad already has a timeline';
  end if;
  return created;
end;
$$;
revoke execute on function public.create_ad_timeline(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_ad_timeline(uuid, jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- restore_auto_edit_cut: put an earlier Auto-edit result back on the
-- timeline (with its findings).
-- ---------------------------------------------------------------
create or replace function public.restore_auto_edit_cut(target_run_id uuid)
returns public.ad_timelines
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.auto_edit_runs;
  ad_row public.ads;
  saved public.ad_timelines;
begin
  select * into run_row from public.auto_edit_runs where id = target_run_id;
  if run_row.id is null or not public.has_scope_access(run_row.org_id, run_row.brand_id, run_row.ad_id) then
    raise exception 'Auto-edit run not found';
  end if;
  ad_row := public.assert_ad_editable(run_row.ad_id);
  if run_row.status <> 'succeeded' or run_row.plan is null then
    raise exception 'only a finished cut can be restored';
  end if;
  if exists (
    select 1 from public.auto_edit_runs r
    where r.ad_id = ad_row.id and r.status not in ('succeeded', 'failed', 'cancelled')
  ) then
    raise exception 'timeline_locked: an Auto-edit is working on this timeline';
  end if;
  update public.ad_timelines
  set plan = run_row.plan, findings = run_row.findings, mode = run_row.mode, source_run_id = run_row.id,
      version = version + 1, updated_by = auth.uid()
  where ad_id = ad_row.id
  returning * into saved;
  if saved.ad_id is null then
    raise exception 'no timeline yet';
  end if;
  return saved;
end;
$$;
revoke execute on function public.restore_auto_edit_cut(uuid) from public, anon;
grant execute on function public.restore_auto_edit_cut(uuid) to authenticated;

-- ---------------------------------------------------------------
-- request_auto_edit_revision_for_ad: a revision chat turn on the current
-- timeline (Claude's cut, manual edits included). Snapshots it as the
-- run's base; the run's findings are the timeline's.
-- ---------------------------------------------------------------
create or replace function public.request_auto_edit_revision_for_ad(target_ad_id uuid, revision_instruction text)
returns public.auto_edit_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
  tl public.ad_timelines;
  clean_instruction text := nullif(trim(coalesce(revision_instruction, '')), '');
  new_run public.auto_edit_runs;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  if clean_instruction is null then
    raise exception 'say what to change';
  end if;
  if char_length(clean_instruction) > 2000 then
    raise exception 'keep the request under 2000 characters';
  end if;
  select * into tl from public.ad_timelines where ad_id = ad_row.id;
  if tl.ad_id is null then
    raise exception 'start an edit first';
  end if;
  perform public.expire_stalled_auto_edits(ad_row.id);
  if exists (
    select 1 from public.auto_edit_runs r
    where r.ad_id = ad_row.id and r.status not in ('succeeded', 'failed', 'cancelled')
  ) then
    raise exception 'an Auto-edit is already running for this ad';
  end if;
  insert into public.auto_edit_runs (org_id, brand_id, ad_id, parent_run_id, kind, mode, instruction, findings, base_plan, base_version, requested_by)
  values (
    ad_row.org_id, ad_row.brand_id, ad_row.id, tl.source_run_id,
    case when tl.source_run_id is null then 'edit' else 'revision' end,
    tl.mode, clean_instruction, tl.findings, tl.plan, tl.version, auth.uid()
  )
  returning * into new_run;
  return new_run;
end;
$$;
revoke execute on function public.request_auto_edit_revision_for_ad(uuid, text) from public, anon;
grant execute on function public.request_auto_edit_revision_for_ad(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- Render MP4 / Export project for...: one render job per ad at a time,
-- against a snapshot of the timeline.
-- ---------------------------------------------------------------
create or replace function public.expire_stalled_ad_renders(target_ad_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ad_renders
  set status = 'failed', error_code = 'RENDER_FAILED', error = 'The render worker stopped responding.', finished_at = now()
  where ad_id = target_ad_id
    and status in ('queued', 'rendering')
    and updated_at < now() - interval '45 minutes';
$$;
revoke execute on function public.expire_stalled_ad_renders(uuid) from public, anon, authenticated;

create or replace function public.request_ad_render(target_ad_id uuid, render_kind text, export_format text)
returns public.ad_renders
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
  tl public.ad_timelines;
  new_render public.ad_renders;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  if render_kind is null or render_kind not in ('mp4', 'export') then
    raise exception 'invalid render';
  end if;
  if render_kind = 'export' and (export_format is null or export_format not in ('concat', 'premiere', 'resolve', 'fcp', 'capcut')) then
    raise exception 'invalid export format';
  end if;
  select * into tl from public.ad_timelines where ad_id = ad_row.id;
  if tl.ad_id is null then
    raise exception 'start an edit first';
  end if;
  perform public.expire_stalled_ad_renders(ad_row.id);
  if exists (select 1 from public.ad_renders r where r.ad_id = ad_row.id and r.status in ('queued', 'rendering')) then
    raise exception 'a render is already running for this ad';
  end if;
  insert into public.ad_renders (org_id, brand_id, ad_id, kind, format, plan, mode, timeline_version, requested_by)
  values (ad_row.org_id, ad_row.brand_id, ad_row.id, render_kind, case when render_kind = 'export' then export_format end,
          tl.plan, tl.mode, tl.version, auth.uid())
  returning * into new_render;
  return new_render;
end;
$$;
revoke execute on function public.request_ad_render(uuid, text, text) from public, anon;
grant execute on function public.request_ad_render(uuid, text, text) to authenticated;
