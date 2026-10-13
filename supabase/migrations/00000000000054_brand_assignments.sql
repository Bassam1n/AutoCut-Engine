-- M3: brand assignment. Owners and admins see every brand; a user
-- (editor) sees only the brands an owner or admin assigned to them,
-- and everything under those brands: products, refs, specs,
-- customers, brand cast, ads and every ad-scoped table.
--
-- Unassigning flips `active` off rather than removing the row, so the
-- history of who had access stays visible (and no destructive
-- statement is needed).
--
-- Library and styles stay org-wide shared assets.

create table public.brand_assignments (
  brand_id uuid not null references public.brands (id),
  user_id uuid not null references auth.users (id),
  org_id uuid not null references public.orgs (id),
  active boolean not null default true,
  assigned_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create index brand_assignments_user_idx on public.brand_assignments (user_id, org_id) where active;

alter table public.brand_assignments enable row level security;

-- Owners/admins see all of the org's assignments; a user sees their own.
create policy brand_assignments_select on public.brand_assignments
  for select using (public.is_org_admin(org_id) or user_id = auth.uid());

-- ---------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so they can read brands/ads/
-- assignments without recursing through those tables' own RLS.
-- ---------------------------------------------------------------

create or replace function public.has_brand_access(check_org_id uuid, check_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_admin(check_org_id)
    or (
      public.is_org_member(check_org_id)
      and exists (
        select 1 from public.brand_assignments ba
        where ba.brand_id = check_brand_id
          and ba.org_id = check_org_id
          and ba.user_id = auth.uid()
          and ba.active
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
  select public.is_org_admin(check_org_id)
    or exists (
      select 1 from public.products p
      where p.id = check_product_id
        and p.org_id = check_org_id
        and public.has_brand_access(check_org_id, p.brand_id)
    );
$$;

-- For rows that may hang off a brand and/or an ad (either can be
-- null). A row with neither is org-level and visible to any member.
create or replace function public.has_scope_access(check_org_id uuid, check_brand_id uuid, check_ad_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_admin(check_org_id)
    or (
      public.is_org_member(check_org_id)
      and (check_brand_id is null or public.has_brand_access(check_org_id, check_brand_id))
      and (
        check_ad_id is null
        or exists (
          select 1 from public.ads a
          where a.id = check_ad_id
            and a.org_id = check_org_id
            and public.has_brand_access(check_org_id, a.brand_id)
        )
      )
    );
$$;

-- ---------------------------------------------------------------
-- Brand-level tables.
-- ---------------------------------------------------------------

alter policy brands_select on public.brands
  using (public.has_brand_access(org_id, id));
alter policy brands_update on public.brands
  using (public.member_can_manage_brand_content(org_id) and public.has_brand_access(org_id, id))
  with check (public.member_can_manage_brand_content(org_id) and public.has_brand_access(org_id, id));

alter policy customers_select on public.customers
  using (public.has_brand_access(org_id, brand_id));
alter policy customers_insert on public.customers
  with check (public.has_brand_access(org_id, brand_id));
alter policy customers_update on public.customers
  using (public.has_brand_access(org_id, brand_id))
  with check (public.has_brand_access(org_id, brand_id));

alter policy brand_cast_members_select on public.brand_cast_members
  using (public.has_brand_access(org_id, brand_id));
alter policy brand_cast_members_insert on public.brand_cast_members
  with check (public.has_brand_access(org_id, brand_id));
alter policy brand_cast_members_update on public.brand_cast_members
  using (public.has_brand_access(org_id, brand_id))
  with check (public.has_brand_access(org_id, brand_id));

alter policy products_select on public.products
  using (public.has_brand_access(org_id, brand_id));
alter policy products_insert on public.products
  with check (public.member_can_manage_brand_content(org_id) and public.has_brand_access(org_id, brand_id));
alter policy products_update on public.products
  using (public.member_can_manage_brand_content(org_id) and public.has_brand_access(org_id, brand_id))
  with check (public.member_can_manage_brand_content(org_id) and public.has_brand_access(org_id, brand_id));

alter policy product_refs_select on public.product_refs
  using (public.has_product_access(org_id, product_id));
alter policy product_refs_insert on public.product_refs
  with check (public.member_can_manage_brand_content(org_id) and public.has_product_access(org_id, product_id));
alter policy product_refs_update on public.product_refs
  using (public.member_can_manage_brand_content(org_id) and public.has_product_access(org_id, product_id))
  with check (public.member_can_manage_brand_content(org_id) and public.has_product_access(org_id, product_id));

alter policy product_specs_select on public.product_specs
  using (public.has_product_access(org_id, product_id));
alter policy product_specs_insert on public.product_specs
  with check (public.has_product_access(org_id, product_id));
alter policy product_specs_update_approval on public.product_specs
  using (public.has_product_access(org_id, product_id))
  with check (public.has_product_access(org_id, product_id));

-- ---------------------------------------------------------------
-- Ads and ad-scoped tables.
-- ---------------------------------------------------------------

alter policy ads_select on public.ads
  using (public.has_brand_access(org_id, brand_id));
alter policy ads_insert on public.ads
  with check (public.member_can_create_ads(org_id) and public.has_brand_access(org_id, brand_id));
alter policy ads_update on public.ads
  using (public.has_brand_access(org_id, brand_id))
  with check (public.has_brand_access(org_id, brand_id));

alter policy ad_scripts_select on public.ad_scripts using (public.has_scope_access(org_id, null, ad_id));
alter policy ad_scripts_insert on public.ad_scripts with check (public.has_scope_access(org_id, null, ad_id));
alter policy ad_scripts_update on public.ad_scripts
  using (public.has_scope_access(org_id, null, ad_id)) with check (public.has_scope_access(org_id, null, ad_id));

alter policy concepts_select on public.concepts using (public.has_scope_access(org_id, null, ad_id));
alter policy concepts_insert on public.concepts with check (public.has_scope_access(org_id, null, ad_id));
alter policy concepts_update on public.concepts
  using (public.has_scope_access(org_id, null, ad_id)) with check (public.has_scope_access(org_id, null, ad_id));

alter policy cast_members_select on public.cast_members using (public.has_scope_access(org_id, null, ad_id));
alter policy cast_members_insert on public.cast_members with check (public.has_scope_access(org_id, null, ad_id));
alter policy cast_members_update on public.cast_members
  using (public.has_scope_access(org_id, null, ad_id)) with check (public.has_scope_access(org_id, null, ad_id));

alter policy scenes_select on public.scenes using (public.has_scope_access(org_id, null, ad_id));
alter policy scenes_insert on public.scenes with check (public.has_scope_access(org_id, null, ad_id));
alter policy scenes_update on public.scenes
  using (public.has_scope_access(org_id, null, ad_id)) with check (public.has_scope_access(org_id, null, ad_id));

alter policy assets_select on public.assets using (public.has_scope_access(org_id, brand_id, ad_id));
alter policy jobs_select on public.jobs using (public.has_scope_access(org_id, null, ad_id));
alter policy gates_select on public.gates using (public.has_scope_access(org_id, null, ad_id));
alter policy phase_runs_select on public.phase_runs using (public.has_scope_access(org_id, null, ad_id));
alter policy fallback_events_select on public.fallback_events using (public.has_scope_access(org_id, null, ad_id));
alter policy spend_events_select on public.spend_events using (public.has_scope_access(org_id, null, ad_id));
alter policy feedback_events_select on public.feedback_events using (public.has_scope_access(org_id, null, ad_id));
alter policy feedback_events_insert on public.feedback_events with check (public.has_scope_access(org_id, null, ad_id));

-- ---------------------------------------------------------------
-- Assigning.
-- ---------------------------------------------------------------

-- Replaces the brand's assignee list with exactly target_user_ids.
-- Only users (editors) are assignable: owners and admins already see
-- every brand.
create or replace function public.set_brand_assignees(
  target_org_id uuid,
  target_brand_id uuid,
  target_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bad_user uuid;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can assign brands';
  end if;

  if not exists (select 1 from public.brands where id = target_brand_id and org_id = target_org_id) then
    raise exception 'brand does not belong to this org';
  end if;

  select u into bad_user
  from unnest(coalesce(target_user_ids, '{}')) as u
  where not exists (
    select 1 from public.org_members m
    where m.org_id = target_org_id and m.user_id = u and m.role = 'editor'
  )
  limit 1;

  if bad_user is not null then
    raise exception 'only users in this org can be assigned to a brand';
  end if;

  update public.brand_assignments
  set active = false, assigned_by = auth.uid(), updated_at = now()
  where brand_id = target_brand_id
    and active
    and not (user_id = any (coalesce(target_user_ids, '{}')));

  insert into public.brand_assignments (brand_id, user_id, org_id, active, assigned_by)
  select target_brand_id, u, target_org_id, true, auth.uid()
  from unnest(coalesce(target_user_ids, '{}')) as u
  on conflict (brand_id, user_id) do update
    set active = true, assigned_by = auth.uid(), updated_at = now();

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'brand_assignees_changed',
          target_brand_id::text || ' -> ' || coalesce(array_length(target_user_ids, 1), 0)::text || ' users');
end;
$$;
