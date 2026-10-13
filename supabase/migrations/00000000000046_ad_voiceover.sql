-- M10 (voiceover slice only — spec §5.4 bullet 5 / §6 M10): whole-ad
-- voiceover generation needs a job-creation RPC, and the only one that
-- exists (request_scene_regen, migration 14) is scene-scoped — it
-- requires a target_scene_id and looks up scenes.org_id/ad_id from it.
-- A whole-ad voiceover is not scene-scoped (one continuous VO per ad,
-- stored with scene_id null per the assets.ad_or_brand/scene nullability
-- already in place), so request_scene_regen can't be reused as-is.
--
-- request_ad_voiceover mirrors request_scene_regen's exact shape
-- (membership check, fresh idempotency_key, insert into jobs, return
-- the row) but looks up org_id straight from ads and never touches
-- scene_id at all (jobs.scene_id stays null — jobs.scene_id is already
-- nullable, migration 9).
create or replace function public.request_ad_voiceover(
  target_ad_id uuid,
  regen_payload jsonb default '{}'::jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_org_id uuid;
  new_job public.jobs;
begin
  select org_id into ad_org_id
  from public.ads
  where id = target_ad_id;

  if ad_org_id is null then
    raise exception 'ad not found';
  end if;

  if not public.is_org_member(ad_org_id) then
    raise exception 'not a member of this org';
  end if;

  insert into public.jobs (
    org_id, ad_id, scene_id, kind, idempotency_key, payload
  )
  values (
    ad_org_id, target_ad_id, null, 'generate_ad_voiceover',
    target_ad_id::text || ':generate_ad_voiceover:' || gen_random_uuid()::text,
    regen_payload
  )
  returning * into new_job;

  return new_job;
end;
$$;
