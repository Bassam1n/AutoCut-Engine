-- Permanent ad deletion, and file cleanup for archived ads.
--
-- Deleting an ad cascades to its scenes, assets, scripts and jobs, but
-- spend history and board tasks are kept: their ad link is cleared.
-- Archived ads lose their files 90 days after archiving (the daily
-- purge-archived-assets task), except anything in the Library or used
-- as a cast or style reference.

alter table public.spend_events drop constraint if exists spend_events_ad_id_fkey;
alter table public.spend_events add constraint spend_events_ad_id_fkey
  foreign key (ad_id) references public.ads(id) on delete set null;
alter table public.tasks drop constraint if exists tasks_ad_id_fkey;
alter table public.tasks add constraint tasks_ad_id_fkey
  foreign key (ad_id) references public.ads(id) on delete set null;
alter table public.review_rounds drop constraint if exists review_rounds_ad_id_fkey;
alter table public.review_rounds add constraint review_rounds_ad_id_fkey
  foreign key (ad_id) references public.ads(id) on delete set null;

alter table public.ads add column if not exists archived_at timestamptz;
update public.ads set archived_at = now() where archived and archived_at is null;

create or replace function public.set_ad_archived_at()
returns trigger language plpgsql
as $$
begin
  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := now();
  elsif not new.archived then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger ads_set_archived_at
  before insert or update of archived on public.ads
  for each row execute function public.set_ad_archived_at();

-- Now also covers every file of an ad archived long enough.
create or replace function public.purgeable_archived_assets(older_than_days integer default 90, max_rows integer default 500)
returns table (asset_id uuid, org_id uuid, storage_path text)
language sql stable security definer set search_path = public
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
  order by coalesce(a.archived_at, ad.archived_at)
  limit max_rows;
$$;

revoke execute on function public.purgeable_archived_assets(integer, integer) from anon, authenticated;

-- Every file an ad owns, tracked as an asset or not (feedback uploads).
create or replace function public.ad_storage_paths(target_org_id uuid, target_ad_id uuid)
returns table (bucket text, path text)
language sql stable security definer set search_path = public, storage
as $$
  select o.bucket_id::text, o.name
  from storage.objects o
  where o.bucket_id = 'renders'
    and (o.name like target_org_id::text || '/renders/' || target_ad_id::text || '/%'
      or o.name like target_org_id::text || '/feedback/' || target_ad_id::text || '/%'
      or o.name like target_org_id::text || '/feedback_round/' || target_ad_id::text || '/%')
  union
  select 'renders', a.storage_path from public.assets a
  where a.ad_id = target_ad_id and a.org_id = target_org_id;
$$;

revoke execute on function public.ad_storage_paths(uuid, uuid) from anon, authenticated;

-- References outside the ad that would break if it were deleted.
create or replace function public.ad_delete_blockers(target_org_id uuid, target_ad_id uuid)
returns table (reason text, detail text)
language sql stable security definer set search_path = public
as $$
  select 'brand_cast', bc.name from public.brand_cast_members bc
  join public.assets a on a.id in (bc.ref_asset_id, bc.sheet_asset_id)
  where a.ad_id = target_ad_id and a.org_id = target_org_id
  union all
  select 'style', s.name from public.styles s
  join public.assets a on a.id = s.reference_asset_id
  where a.ad_id = target_ad_id and a.org_id = target_org_id;
$$;

revoke execute on function public.ad_delete_blockers(uuid, uuid) from anon, authenticated;
