-- M3: per-member permission toggles.
--
-- can_create_ads: null means "role default" (users yes, owners and
-- admins no). Only a platform admin sets an explicit true/false, e.g.
-- to let a particular owner create ads after all.
--
-- can_manage_brand_content: lets a user (editor) create and edit
-- products and their reference photos, and edit brand details. Owners
-- and admins always can. Toggled by the org's owner or admin.
--
-- Creating new brands is now owner/admin only. product_specs stay
-- writable by every member because the ad flow writes them
-- automatically (scene-images-actions.ts).

alter table public.org_members add column can_create_ads boolean;

alter table public.org_members add column can_manage_brand_content boolean not null default false;

create or replace function public.member_can_create_ads(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.seat_active = true
      and coalesce(m.can_create_ads, m.role = 'editor')
  );
$$;

create or replace function public.member_can_manage_brand_content(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.seat_active = true
      and (m.role in ('owner', 'admin') or m.can_manage_brand_content)
  );
$$;

alter policy ads_insert on public.ads
  with check (public.member_can_create_ads(org_id));

alter policy brands_insert on public.brands
  with check (public.is_org_admin(org_id));

alter policy brands_update on public.brands
  using (public.member_can_manage_brand_content(org_id))
  with check (public.member_can_manage_brand_content(org_id));

alter policy products_insert on public.products
  with check (public.member_can_manage_brand_content(org_id));

alter policy products_update on public.products
  using (public.member_can_manage_brand_content(org_id))
  with check (public.member_can_manage_brand_content(org_id));

alter policy product_refs_insert on public.product_refs
  with check (public.member_can_manage_brand_content(org_id));

alter policy product_refs_update on public.product_refs
  using (public.member_can_manage_brand_content(org_id))
  with check (public.member_can_manage_brand_content(org_id));

-- create_ad() is SECURITY DEFINER (bypasses ads_insert), so it needs
-- the same check itself. The web app inserts directly today, but this
-- keeps the RPC from being a way around the toggle.
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
  if not public.member_can_create_ads(target_org_id) then
    raise exception 'you don''t have permission to create ads in this org';
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

-- Platform admin: explicit allow/deny, or null to go back to the role default.
create or replace function public.set_member_can_create_ads(
  target_org_id uuid,
  target_user_id uuid,
  allowed boolean
)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.org_members;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change ad creation access';
  end if;

  update public.org_members
  set can_create_ads = allowed
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  if updated_member.user_id is null then
    raise exception 'member not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_ad_access_changed',
          target_user_id::text || ' -> ' || coalesce(allowed::text, 'role default'));

  return updated_member;
end;
$$;

-- Owner or admin: a user's products/brand-details access.
create or replace function public.set_member_brand_content_access(
  target_org_id uuid,
  target_user_id uuid,
  allowed boolean
)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  updated_member public.org_members;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can change this';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'you can''t change your own access';
  end if;

  select role into target_role
  from public.org_members
  where org_id = target_org_id and user_id = target_user_id;

  if target_role is null then
    raise exception 'member not found';
  end if;

  if target_role <> 'editor' then
    raise exception 'owners and admins always have this access';
  end if;

  update public.org_members
  set can_manage_brand_content = allowed
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_brand_access_changed',
          target_user_id::text || ' -> ' || allowed::text);

  return updated_member;
end;
$$;

-- Platform admin's per-member permission view (list_all_orgs_with_members
-- predates these columns and its return type can't change in place).
create or replace function public.list_all_member_permissions()
returns table (
  org_id uuid,
  user_id uuid,
  role text,
  can_create_ads boolean,
  can_manage_brand_content boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can list member permissions';
  end if;

  return query
    select m.org_id, m.user_id, m.role, m.can_create_ads, m.can_manage_brand_content
    from public.org_members m;
end;
$$;

-- The ad studio only needs to know WHICH providers have a key, to warn
-- before generating. list_org_secrets (owner-only) and
-- list_brand_secrets (owner/admin) left users, and since migration 52
-- admins, unable to load the studio. Provider names only, any member.
create or replace function public.list_providers_with_keys(target_org_id uuid, target_brand_id uuid default null)
returns table (provider text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org_id) then
    raise exception 'not a member of this org';
  end if;

  return query
    select s.provider from public.org_secrets s where s.org_id = target_org_id
    union
    select b.provider from public.brand_secrets b
    where target_brand_id is not null and b.org_id = target_org_id and b.brand_id = target_brand_id;
end;
$$;
