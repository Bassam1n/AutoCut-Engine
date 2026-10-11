-- M1: RPCs for ad creation, job cancellation, and scene regeneration
-- requests. decide_gate() is in its own migration (next file) — it's the
-- most important RPC in the schema and gets its own focused treatment.

-- create_ad: the only way to create an ads row. Requires org membership;
-- brand/product/style must belong to the same org (checked explicitly
-- rather than relying on the FK alone, since a FK only proves the row
-- exists somewhere, not that it's in the caller's org).
create or replace function public.create_ad(
  target_org_id uuid,
  target_brand_id uuid,
  ad_mode text,
  ad_brief jsonb default '{}'::jsonb,
  target_product_id uuid default null,
  target_style_id uuid default null
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ad public.ads;
begin
  if not public.is_org_member(target_org_id) then
    raise exception 'not a member of this org';
  end if;

  if not exists (
    select 1 from public.brands
    where id = target_brand_id and org_id = target_org_id
  ) then
    raise exception 'brand does not belong to this org';
  end if;

  if target_product_id is not null and not exists (
    select 1 from public.products
    where id = target_product_id and org_id = target_org_id
  ) then
    raise exception 'product does not belong to this org';
  end if;

  if ad_mode not in ('studio', 'autopilot') then
    raise exception 'invalid ad mode: %', ad_mode;
  end if;

  insert into public.ads (org_id, brand_id, product_id, style_id, mode, brief)
  values (target_org_id, target_brand_id, target_product_id, target_style_id, ad_mode, ad_brief)
  returning * into new_ad;

  return new_ad;
end;
$$;

-- cancel_job: the browser role's one allowed touch on a job row. Flips
-- cancel_requested — never status, payload, or external_task_id directly
-- — the workflow engine observes the flag and performs the actual
-- cancellation (which may need to call a provider's cancel endpoint)
-- rather than the client declaring the job cancelled itself.
create or replace function public.cancel_job(target_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job_org_id uuid;
  updated_job public.jobs;
begin
  select org_id into job_org_id from public.jobs where id = target_job_id;

  if job_org_id is null then
    raise exception 'job not found';
  end if;

  if not public.is_org_member(job_org_id) then
    raise exception 'not a member of this org';
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

-- request_scene_regen: the editor-facing entry point for "regenerate this
-- scene." Inserts a job row with a fresh idempotency_key (so a double
-- click doesn't queue the same regen twice within the same request) and
-- leaves the actual provider call to the workflow engine.
create or replace function public.request_scene_regen(
  target_scene_id uuid,
  regen_kind text,
  regen_payload jsonb default '{}'::jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  scene_org_id uuid;
  scene_ad_id uuid;
  new_job public.jobs;
begin
  select org_id, ad_id into scene_org_id, scene_ad_id
  from public.scenes
  where id = target_scene_id;

  if scene_org_id is null then
    raise exception 'scene not found';
  end if;

  if not public.is_org_member(scene_org_id) then
    raise exception 'not a member of this org';
  end if;

  insert into public.jobs (
    org_id, ad_id, scene_id, kind, idempotency_key, payload
  )
  values (
    scene_org_id, scene_ad_id, target_scene_id, regen_kind,
    target_scene_id::text || ':' || regen_kind || ':' || gen_random_uuid()::text,
    regen_payload
  )
  returning * into new_job;

  return new_job;
end;
$$;
