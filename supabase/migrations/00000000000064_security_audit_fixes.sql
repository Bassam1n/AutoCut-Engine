-- Fixes from the October 2026 security audit. Applied in chunks through
-- the Supabase MCP; this file is the combined record.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and anon and
-- authenticated inherit it, so `revoke ... from anon, authenticated`
-- alone (as several earlier migrations did) does not close a function.
-- Each revoke below names PUBLIC as well.

-- ---------------------------------------------------------------
-- 1. Internal functions that were callable by anyone through PostgREST.
-- ---------------------------------------------------------------

-- Trigger/internal helpers: no app code calls these with a user client.
revoke execute on function public.notify_org_admins(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.ad_link(uuid) from public, anon, authenticated;
-- Agencies are created by platform admins only (migration 017).
revoke execute on function public.create_org(text) from public, anon, authenticated;
-- The app inserts ads through RLS; this definer path skipped brand scope.
revoke execute on function public.create_ad(uuid, uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;
-- Gates are not used by the app and decide_gate skipped brand scope.
revoke execute on function public.decide_gate(uuid, text, jsonb) from public, anon, authenticated;

-- The login server action calls this with the service client.
revoke execute on function public.email_is_known_for_signin(text) from public, anon, authenticated;
grant execute on function public.email_is_known_for_signin(text) to service_role;

-- Service-role-only storage helpers (062/063 revoked only anon/authenticated).
revoke execute on function public.purgeable_archived_assets(integer, integer) from public;
revoke execute on function public.ad_storage_paths(uuid, uuid) from public;
revoke execute on function public.ad_delete_blockers(uuid, uuid) from public;
revoke execute on function public.org_storage_bytes(uuid) from public;

-- Spend and seat usage: members, the platform admin (org_usage) and the
-- service role (record_spend_event) only.
create or replace function public.org_spend_24h(target_org_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_org_member(target_org_id) or public.is_platform_admin() or auth.role() = 'service_role') then
    raise exception 'not a member of this org';
  end if;
  return (
    select coalesce(sum(usd_est), 0)
    from public.spend_events
    where org_id = target_org_id
      and created_at > now() - interval '24 hours'
  );
end;
$$;
revoke execute on function public.org_spend_24h(uuid) from public, anon;
grant execute on function public.org_spend_24h(uuid) to authenticated, service_role;

create or replace function public.org_seat_usage(check_org_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_org_member(check_org_id) or public.is_platform_admin() or auth.role() = 'service_role') then
    raise exception 'not a member of this org';
  end if;
  return (
    (select count(*) from public.org_members where org_id = check_org_id and seat_active)
    +
    (select count(*) from public.pending_invites where org_id = check_org_id and accepted_at is null)
  );
end;
$$;
revoke execute on function public.org_seat_usage(uuid) from public, anon;
grant execute on function public.org_seat_usage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- 2. Scope helpers: bind the referenced brand/product/ad to the org for
--    every caller. The admin branch used to return true before checking,
--    so an admin of org Z could write rows pointing at org A's ads.
-- ---------------------------------------------------------------

create or replace function public.has_brand_access(check_org_id uuid, check_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.brands b where b.id = check_brand_id and b.org_id = check_org_id)
    and (
      public.is_org_admin(check_org_id)
      or (
        public.is_org_member(check_org_id)
        and exists (
          select 1 from public.brand_assignments ba
          where ba.brand_id = check_brand_id and ba.org_id = check_org_id
            and ba.user_id = auth.uid() and ba.active
        )
      )
    );
$$;

create or replace function public.has_product_access(check_org_id uuid, check_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.products p
    where p.id = check_product_id and p.org_id = check_org_id
      and public.has_brand_access(check_org_id, p.brand_id)
  );
$$;

create or replace function public.has_scope_access(check_org_id uuid, check_brand_id uuid, check_ad_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(check_org_id)
    and (check_brand_id is null or public.has_brand_access(check_org_id, check_brand_id))
    and (
      check_ad_id is null
      or exists (
        select 1 from public.ads a
        where a.id = check_ad_id and a.org_id = check_org_id
          and public.has_brand_access(check_org_id, a.brand_id)
      )
    );
$$;

-- cancel_job: brand-scoped like request_scene_regen.
create or replace function public.cancel_job(target_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job_org_id uuid;
  job_ad_id uuid;
  updated_job public.jobs;
begin
  select org_id, ad_id into job_org_id, job_ad_id from public.jobs where id = target_job_id;

  if job_org_id is null then
    raise exception 'job not found';
  end if;

  if not public.has_scope_access(job_org_id, null, job_ad_id) then
    raise exception 'job not found';
  end if;

  update public.jobs
  set cancel_requested = true
  where id = target_job_id
    and status in ('queued', 'running')
  returning * into updated_job;

  if updated_job.id is null then
    raise exception 'job is not in a cancellable state';
  end if;

  return updated_job;
end;
$$;

-- Reference-asset columns that the service role later signs: a writer
-- may only point them at an asset they can see. Server code running as
-- the service role is trusted.
create or replace function public.check_reference_asset_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col text;
  new_id uuid;
  old_id uuid;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- Platform styles (org_id null) are edited by platform admins only.
  if new.org_id is null and public.is_platform_admin() then
    return new;
  end if;
  foreach col in array tg_argv loop
    new_id := (to_jsonb(new) ->> col)::uuid;
    old_id := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> col)::uuid end;
    if new_id is not null and new_id is distinct from old_id and not exists (
      select 1 from public.assets a
      where a.id = new_id and a.org_id = new.org_id
        and public.has_scope_access(a.org_id, a.brand_id, a.ad_id)
    ) then
      raise exception 'asset not found';
    end if;
  end loop;
  return new;
end;
$$;

create trigger cast_members_reference_asset_access
  before insert or update on public.cast_members
  for each row execute function public.check_reference_asset_access('ref_asset_id', 'sheet_asset_id');
create trigger brand_cast_members_reference_asset_access
  before insert or update on public.brand_cast_members
  for each row execute function public.check_reference_asset_access('ref_asset_id', 'sheet_asset_id');
create trigger styles_reference_asset_access
  before insert or update on public.styles
  for each row execute function public.check_reference_asset_access('reference_asset_id');

-- Feedback rows: scene_id must belong to the row's ad, or the distill
-- job could derive a product scope from another brand's scene.
alter policy feedback_events_insert on public.feedback_events with check (
  public.has_scope_access(org_id, null, ad_id)
  and (
    scene_id is null
    or exists (
      select 1 from public.scenes s
      where s.id = feedback_events.scene_id
        and s.ad_id = feedback_events.ad_id
        and s.org_id = feedback_events.org_id
    )
  )
);

-- ---------------------------------------------------------------
-- 3. Archived brands are read-only: no new ads and no new generations.
-- ---------------------------------------------------------------

alter policy ads_insert on public.ads with check (
  public.member_can_create_ads(ads.org_id)
  and public.has_brand_access(ads.org_id, ads.brand_id)
  and exists (select 1 from public.brands b where b.id = ads.brand_id and b.org_id = ads.org_id and b.active)
);

-- Called by every paid generation path next to claim_paid_job /
-- claim_paid_media_job.
create or replace function public.assert_brand_active(target_org_id uuid, target_brand_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'assert_brand_active can only be called by the service role';
  end if;
  if not exists (
    select 1 from public.brands where id = target_brand_id and org_id = target_org_id and active
  ) then
    raise exception 'brand_archived: this brand is archived';
  end if;
end;
$$;
revoke execute on function public.assert_brand_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_brand_active(uuid, uuid) to service_role;

-- ---------------------------------------------------------------
-- 4. Seat cap applies to reactivation too. Both paths lock the org row
--    so concurrent invites and reactivations can't both pass the check.
-- ---------------------------------------------------------------

create or replace function public.set_org_member_seat_active(target_org_id uuid, target_user_id uuid, active boolean)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.org_members;
  org_row public.orgs;
  currently_active boolean;
begin
  perform public.assert_owner_can_manage_member(target_org_id, target_user_id);
  if active then
    select * into org_row from public.orgs where id = target_org_id for update;
    select m.seat_active into currently_active
    from public.org_members m
    where m.org_id = target_org_id and m.user_id = target_user_id;
    if currently_active is false
       and org_row.seat_cap is not null
       and public.org_seat_usage(target_org_id) >= org_row.seat_cap then
      raise exception 'seat_cap_reached';
    end if;
  end if;
  update public.org_members set seat_active = active
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;
  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(),
    case when active then 'member_seat_activated' else 'member_seat_deactivated' end,
    target_user_id::text);
  return updated_member;
end;
$$;

create or replace function public.invite_member(target_org_id uuid, invitee_email text, invitee_role text)
returns public.pending_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  org_row public.orgs;
  new_invite public.pending_invites;
  current_usage integer;
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner of this org can invite a member';
  end if;
  if invitee_role not in ('admin', 'editor') then
    raise exception 'invalid role: % (owners are assigned by the platform admin)', invitee_role;
  end if;
  if invitee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email: %', invitee_email;
  end if;
  select * into org_row from public.orgs where id = target_org_id for update;
  if org_row.seat_cap is null then
    raise exception 'seat_cap_not_configured';
  end if;
  select public.org_seat_usage(target_org_id) into current_usage;
  if current_usage >= org_row.seat_cap then
    raise exception 'seat_cap_reached';
  end if;
  insert into public.pending_invites (org_id, email, role, invited_by)
  values (target_org_id, lower(invitee_email), invitee_role, auth.uid())
  returning * into new_invite;
  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_invited', lower(invitee_email));
  return new_invite;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Reviews are bound to the ad that was reviewed.
-- ---------------------------------------------------------------

-- The ad can't be swapped or cleared while a round with an ad is open
-- (a round opened before any ad was linked can still get one).
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
  if exists (
    select 1 from public.review_rounds
    where task_id = target_task_id and status = 'open' and ad_id is not null
  ) then
    raise exception 'this task is in review, so its ad can''t be changed until the review is submitted';
  end if;
  if target_ad_id is not null then
    select * into ad_row from public.ads where id = target_ad_id and org_id = task_row.org_id;
    if ad_row.id is null or not public.has_brand_access(ad_row.org_id, ad_row.brand_id) then
      raise exception 'ad not found';
    end if;
  end if;
  update public.tasks set ad_id = target_ad_id where id = target_task_id returning * into task_row;
  update public.review_rounds set ad_id = target_ad_id where task_id = target_task_id and status = 'open';
  return task_row;
end;
$$;

-- New signature takes the ad the reviewer was shown. The old 3-argument
-- version is closed rather than dropped.
create or replace function public.submit_review(
  target_round_id uuid,
  expected_ad_id uuid,
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
  select * into round_row from public.review_rounds where id = target_round_id for update;
  if round_row.id is null then
    raise exception 'review not found';
  end if;
  if not public.is_org_admin(round_row.org_id) then
    raise exception 'only an owner or admin can review';
  end if;
  if round_row.status <> 'open' then
    raise exception 'this review round has already been submitted';
  end if;
  if round_row.ad_id is null then
    raise exception 'this task has no ad linked yet';
  end if;
  if round_row.ad_id is distinct from expected_ad_id then
    raise exception 'the ad under review changed; reload and review again';
  end if;
  if jsonb_typeof(coalesce(verdicts, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid verdicts';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(verdicts, '[]'::jsonb)) as v(scene_id uuid)
    where not exists (select 1 from public.scenes s where s.id = v.scene_id and s.ad_id = round_row.ad_id)
  ) then
    raise exception 'invalid verdicts';
  end if;
  insert into public.scene_reviews (org_id, round_id, scene_id, verdict, comment)
  select round_row.org_id, round_row.id, s.id, v.verdict, nullif(trim(v.comment), '')
  from jsonb_to_recordset(coalesce(verdicts, '[]'::jsonb)) as v(scene_id uuid, verdict text, comment text)
  join public.scenes s on s.id = v.scene_id and s.ad_id = round_row.ad_id;
  select exists (select 1 from public.scene_reviews where round_id = round_row.id and verdict = 'changes') into has_changes;
  if not has_changes and nullif(trim(coalesce(review_note, '')), '') is not null
     and not exists (select 1 from public.scene_reviews where round_id = round_row.id) then
    has_changes := true;
  end if;
  update public.review_rounds
  set status = case when has_changes then 'changes_requested' else 'approved' end,
      overall_note = nullif(trim(coalesce(review_note, '')), ''),
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = round_row.id
  returning * into round_row;
  target_stage := case when has_changes then 'revisions' else 'done' end;
  select id into target_column from public.task_columns
  where org_id = round_row.org_id and stage = target_stage and not archived limit 1;
  if target_column is not null then
    update public.tasks set column_id = target_column where id = round_row.task_id;
  end if;
  return round_row;
end;
$$;
revoke execute on function public.submit_review(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.submit_review(uuid, uuid, text, jsonb) to authenticated;
revoke execute on function public.submit_review(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 6. File cleanup never removes a path another asset row still uses.
--    addLibraryItemToScene now copies files, but older rows may share.
-- ---------------------------------------------------------------

create or replace function public.purgeable_archived_assets(older_than_days integer default 90, max_rows integer default 500)
returns table(asset_id uuid, org_id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.org_id, a.storage_path
  from public.assets a
  join public.ads ad on ad.id = a.ad_id
  where (
      (a.archived and a.archived_at < now() - make_interval(days => older_than_days))
      or (ad.archived and ad.archived_at < now() - make_interval(days => older_than_days))
    )
    and not exists (select 1 from public.library_items l where l.asset_id = a.id)
    and not exists (select 1 from public.cast_members c where c.ref_asset_id = a.id or c.sheet_asset_id = a.id)
    and not exists (select 1 from public.brand_cast_members bc where bc.ref_asset_id = a.id or bc.sheet_asset_id = a.id)
    and not exists (select 1 from public.styles s where s.reference_asset_id = a.id)
    and not exists (select 1 from public.assets o where o.storage_path = a.storage_path and o.id <> a.id)
  order by coalesce(a.archived_at, ad.archived_at)
  limit max_rows;
$$;

create or replace function public.ad_storage_paths(target_org_id uuid, target_ad_id uuid)
returns table(bucket text, path text)
language sql
stable
security definer
set search_path = public, storage
as $$
  select * from (
    select o.bucket_id::text as bucket, o.name as path
    from storage.objects o
    where o.bucket_id = 'renders'
      and (o.name like target_org_id::text || '/renders/' || target_ad_id::text || '/%'
        or o.name like target_org_id::text || '/feedback/' || target_ad_id::text || '/%'
        or o.name like target_org_id::text || '/feedback_round/' || target_ad_id::text || '/%')
    union
    select 'renders', a.storage_path from public.assets a
    where a.ad_id = target_ad_id and a.org_id = target_org_id
  ) p
  where not exists (
    select 1 from public.assets other
    where other.storage_path = p.path
      and other.ad_id is distinct from target_ad_id
  );
$$;

-- ---------------------------------------------------------------
-- 7. Platform-admin notes move out of orgs (which every member can
--    select) into a table only platform admins can read.
-- ---------------------------------------------------------------

create table public.org_internal_notes (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  notes text check (notes is null or char_length(notes) <= 10000),
  updated_at timestamptz not null default now()
);
alter table public.org_internal_notes enable row level security;
create policy org_internal_notes_select on public.org_internal_notes
  for select using (public.is_platform_admin());

insert into public.org_internal_notes (org_id, notes)
select id, internal_notes from public.orgs where internal_notes is not null;
update public.orgs set internal_notes = null where internal_notes is not null;
alter table public.orgs add constraint orgs_internal_notes_moved check (internal_notes is null);

create or replace function public.platform_update_org(target_org_id uuid, new_name text, new_plan text, new_notes text)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
  clean_notes text := nullif(trim(coalesce(new_notes, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can edit an agency';
  end if;
  if new_name is null or char_length(trim(new_name)) = 0 then
    raise exception 'agency name is required';
  end if;
  update public.orgs
  set name = trim(new_name), plan = new_plan
  where id = target_org_id
  returning * into updated_org;
  if updated_org.id is null then
    raise exception 'agency not found';
  end if;
  insert into public.org_internal_notes (org_id, notes) values (target_org_id, clean_notes)
  on conflict (org_id) do update set notes = excluded.notes, updated_at = now();
  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'agency_updated', trim(new_name) || ' / ' || new_plan);
  return updated_org;
end;
$$;

-- platform_org_overview is unchanged apart from reading notes from the
-- new table.
create or replace function public.platform_org_overview()
returns table(org_id uuid, org_name text, plan text, created_at timestamp with time zone, paused boolean, pause_reason text, suspended_at timestamp with time zone, suspended_reason text, seat_cap integer, warn_usd numeric, stop_usd numeric, internal_notes text, owner_email text, owner_accepted boolean, members_active integer, members_total integer, pending_invites integer, brands_count integer, ads_total integer, ads_30d integer, spend_24h numeric, spend_7d numeric, spend_30d numeric, keys_count integer, last_activity timestamp with time zone)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view all agencies';
  end if;
  return query
  select
    o.id, o.name, o.plan, o.created_at, o.paused, o.pause_reason, o.suspended_at, o.suspended_reason,
    o.seat_cap, o.warn_usd, o.stop_usd,
    (select n.notes from public.org_internal_notes n where n.org_id = o.id),
    coalesce(
      (select u.email::text from public.org_members m join auth.users u on u.id = m.user_id
       where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
      (select pi.email from public.pending_invites pi
       where pi.org_id = o.id and pi.role = 'owner' and pi.accepted_at is null order by pi.created_at limit 1)
    ),
    exists (select 1 from public.org_members m where m.org_id = o.id and m.role = 'owner'),
    (select count(*)::int from public.org_members m where m.org_id = o.id and m.seat_active),
    (select count(*)::int from public.org_members m where m.org_id = o.id),
    (select count(*)::int from public.pending_invites pi where pi.org_id = o.id and pi.accepted_at is null),
    (select count(*)::int from public.brands b where b.org_id = o.id and b.active),
    (select count(*)::int from public.ads a where a.org_id = o.id),
    (select count(*)::int from public.ads a where a.org_id = o.id and a.created_at > now() - interval '30 days'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '24 hours'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '7 days'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '30 days'),
    (select count(*)::int from public.org_secrets k where k.org_id = o.id),
    greatest(
      (select max(a.created_at) from public.audit_log a where a.org_id = o.id),
      (select max(s.created_at) from public.spend_events s where s.org_id = o.id),
      (select max(ad.updated_at) from public.ads ad where ad.org_id = o.id)
    )
  from public.orgs o
  order by o.created_at desc;
end;
$$;
