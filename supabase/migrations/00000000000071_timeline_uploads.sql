-- Clips uploaded from the editor's device onto an ad's timeline: extra
-- footage that wasn't generated in AutoCut. The browser uploads the file
-- straight to the renders bucket (as it does for reference images), under
-- the ad's folder so it goes when the ad goes, then records it here.
-- Each upload is an ad asset of kind 'broll' with a clip number of 1000
-- and up in meta.clipIndex: the timeline refers to footage by number
-- (scenes are 0..n), so an uploaded clip is placed, trimmed, previewed,
-- rendered and exported exactly like a scene clip.
--
-- Same access as the other timeline writes (assert_ad_editable: brand
-- access, ad and brand not archived). Writes go through these functions
-- only; assets stays service-role-only for direct writes.

create unique index if not exists assets_upload_clip_index
  on public.assets (ad_id, ((meta->>'clipIndex')::int))
  where kind = 'broll';

-- ---------------------------------------------------------------
-- timeline_upload_folder: where the browser may upload for this ad.
-- ---------------------------------------------------------------
create or replace function public.timeline_upload_folder(target_ad_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ad_row public.ads;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  return ad_row.org_id::text || '/renders/' || ad_row.id::text || '/auto-edit/uploads/';
end;
$$;
revoke execute on function public.timeline_upload_folder(uuid) from public, anon;
grant execute on function public.timeline_upload_folder(uuid) to authenticated;

-- ---------------------------------------------------------------
-- add_timeline_upload: records an uploaded clip once its file is in
-- storage. clip_meta carries what the browser measured (name, seconds,
-- width, height); the size and type come from storage itself.
-- ---------------------------------------------------------------
create or replace function public.add_timeline_upload(target_ad_id uuid, upload_path text, clip_meta jsonb)
returns public.assets
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  ad_row public.ads;
  folder text;
  obj storage.objects;
  next_index integer;
  seconds numeric;
  created public.assets;
begin
  ad_row := public.assert_ad_editable(target_ad_id);
  folder := ad_row.org_id::text || '/renders/' || ad_row.id::text || '/auto-edit/uploads/';
  if upload_path is null or left(upload_path, length(folder)) <> folder or upload_path like '%..%' or position('/' in substr(upload_path, length(folder) + 1)) > 0 then
    raise exception 'invalid upload path';
  end if;
  select * into obj from storage.objects o where o.bucket_id = 'renders' and o.name = upload_path;
  if obj.id is null then
    raise exception 'the upload did not finish; try again';
  end if;
  if coalesce(obj.metadata->>'mimetype', '') not like 'video/%' then
    raise exception 'only video files can go on the timeline';
  end if;
  if coalesce((obj.metadata->>'size')::bigint, 0) > 52428800 then
    raise exception 'clips can be up to 50 MB';
  end if;
  seconds := nullif(clip_meta->>'duration', '')::numeric;
  if seconds is null or seconds <= 0 or seconds > 600 then
    raise exception 'could not read the clip''s length';
  end if;
  if exists (select 1 from public.assets a where a.ad_id = ad_row.id and a.kind = 'broll' and a.storage_path = upload_path) then
    raise exception 'that clip is already on this ad';
  end if;

  -- One clip number at a time per ad.
  perform 1 from public.ads where id = ad_row.id for update;
  select coalesce(max((a.meta->>'clipIndex')::int), 999) + 1 into next_index
  from public.assets a where a.ad_id = ad_row.id and a.kind = 'broll';

  insert into public.assets (org_id, ad_id, kind, storage_path, source, meta)
  values (
    ad_row.org_id, ad_row.id, 'broll', upload_path, 'upload',
    jsonb_build_object(
      'clipIndex', next_index,
      'name', left(coalesce(clip_meta->>'name', 'Clip'), 120),
      'duration', round(seconds, 3),
      'width', coalesce(nullif(clip_meta->>'width', '')::int, 0),
      'height', coalesce(nullif(clip_meta->>'height', '')::int, 0),
      'bytes', (obj.metadata->>'size')::bigint,
      'uploadedBy', auth.uid()
    )
  )
  returning * into created;
  return created;
end;
$$;
revoke execute on function public.add_timeline_upload(uuid, text, jsonb) from public, anon;
grant execute on function public.add_timeline_upload(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- remove_timeline_upload: takes a clip out of the ad's media. Refused
-- while the timeline still uses it; the file goes with the archive purge.
-- ---------------------------------------------------------------
create or replace function public.remove_timeline_upload(target_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row public.assets;
  ad_row public.ads;
begin
  select * into asset_row from public.assets where id = target_asset_id and kind = 'broll';
  if asset_row.id is null then
    raise exception 'clip not found';
  end if;
  -- Brand access and archived checks, as for every timeline write.
  ad_row := public.assert_ad_editable(asset_row.ad_id);
  if exists (
    select 1 from public.ad_timelines t, jsonb_array_elements(t.plan->'clips') c
    where t.ad_id = ad_row.id and (c->>'scene')::int = (asset_row.meta->>'clipIndex')::int
  ) then
    raise exception 'this clip is on the timeline; take it off the timeline first';
  end if;
  update public.assets set archived = true, archived_at = now() where id = asset_row.id;
end;
$$;
revoke execute on function public.remove_timeline_upload(uuid) from public, anon;
grant execute on function public.remove_timeline_upload(uuid) to authenticated;
