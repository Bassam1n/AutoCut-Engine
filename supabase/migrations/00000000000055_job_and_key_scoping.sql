-- M3 security fixes found while auditing brand assignment.
--
-- 1. get_brand_secret_value looked a brand's key up by brand_id alone,
--    so a request naming another org's brand resolved that org's key.
-- 2. request_scene_regen / request_ad_voiceover stored the caller's
--    payload as-is, and the job runner reads payload.orgId/brandId to
--    pick the provider key and bill spend. A member of one org could
--    queue a job naming another org (or, within an org, a brand they
--    aren't assigned to). The RPCs now check brand access to the scene's
--    ad and overwrite orgId/brandId with the ad's real values.

create or replace function public.get_brand_secret_value(target_org_id uuid, target_brand_id uuid, target_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret_value text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'get_brand_secret_value can only be called by the service role';
  end if;

  select ds.decrypted_secret into secret_value
  from public.brand_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = target_org_id
    and s.brand_id = target_brand_id
    and s.provider = target_provider;

  if secret_value is not null then
    return secret_value;
  end if;

  select ds.decrypted_secret into secret_value
  from public.org_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = target_org_id and s.provider = target_provider;

  if secret_value is null then
    raise exception 'no saved key for brand % or org % provider %', target_brand_id, target_org_id, target_provider;
  end if;

  return secret_value;
end;
$$;

create or replace function public.request_scene_regen(target_scene_id uuid, regen_kind text, regen_payload jsonb default '{}'::jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  scene_org_id uuid;
  scene_ad_id uuid;
  ad_brand_id uuid;
  new_job public.jobs;
begin
  select s.org_id, s.ad_id, a.brand_id into scene_org_id, scene_ad_id, ad_brand_id
  from public.scenes s
  join public.ads a on a.id = s.ad_id
  where s.id = target_scene_id;

  if scene_org_id is null then
    raise exception 'scene not found';
  end if;

  if not public.has_scope_access(scene_org_id, ad_brand_id, scene_ad_id) then
    raise exception 'you don''t have access to this ad';
  end if;

  insert into public.jobs (org_id, ad_id, scene_id, kind, idempotency_key, payload)
  values (
    scene_org_id, scene_ad_id, target_scene_id, regen_kind,
    target_scene_id::text || ':' || regen_kind || ':' || gen_random_uuid()::text,
    coalesce(regen_payload, '{}'::jsonb)
      || jsonb_build_object('orgId', scene_org_id, 'brandId', ad_brand_id)
  )
  returning * into new_job;

  return new_job;
end;
$$;

create or replace function public.request_ad_voiceover(target_ad_id uuid, regen_payload jsonb default '{}'::jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  ad_org_id uuid;
  ad_brand_id uuid;
  new_job public.jobs;
begin
  select org_id, brand_id into ad_org_id, ad_brand_id
  from public.ads
  where id = target_ad_id;

  if ad_org_id is null then
    raise exception 'ad not found';
  end if;

  if not public.has_scope_access(ad_org_id, ad_brand_id, target_ad_id) then
    raise exception 'you don''t have access to this ad';
  end if;

  insert into public.jobs (org_id, ad_id, scene_id, kind, idempotency_key, payload)
  values (
    ad_org_id, target_ad_id, null, 'generate_ad_voiceover',
    target_ad_id::text || ':generate_ad_voiceover:' || gen_random_uuid()::text,
    coalesce(regen_payload, '{}'::jsonb)
      || jsonb_build_object('orgId', ad_org_id, 'brandId', ad_brand_id)
  )
  returning * into new_job;

  return new_job;
end;
$$;
