-- M5: Concept & cast step. The user asked for reusable brand-level
-- "spokesperson" cast members an org can define once and reuse
-- across ads, on top of spec §4's per-ad cast_members (which models
-- cast as extracted fresh per concept, one row per ad). These are
-- not the same concept: brand_cast_members is a library an org
-- builds up over time; cast_members stays per-ad, but a row in it
-- can now point back at a brand_cast_members row when the editor
-- (or the extract_cast Claude call, matching by name/description)
-- recognizes a returning character, reusing its approved reference
-- image instead of generating a new one.

-- assets.ad_id was not-null (M1's original design: every asset
-- belongs to one ad). A brand cast member's reference image needs to
-- be reusable across every ad for that brand, not pinned to whichever
-- ad happened to generate it first — so ad_id is relaxed to nullable
-- and a parallel nullable brand_id is added. Exactly one of
-- (ad_id, brand_id) is set per asset: ad-scoped generation keeps using
-- ad_id as before, brand-level reusable assets (cast references) use
-- brand_id instead.
alter table public.assets alter column ad_id drop not null;
alter table public.assets add column brand_id uuid references public.brands(id) on delete cascade;
alter table public.assets add constraint assets_ad_or_brand_check
  check (
    (ad_id is not null and brand_id is null)
    or (ad_id is null and brand_id is not null)
  );

create table public.brand_cast_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  description text,
  ref_asset_id uuid references public.assets(id),
  sheet_asset_id uuid references public.assets(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger brand_cast_members_set_updated_at
  before update on public.brand_cast_members
  for each row execute function public.set_updated_at();

alter table public.brand_cast_members enable row level security;

create policy brand_cast_members_select on public.brand_cast_members
  for select using (public.is_org_member(org_id));
create policy brand_cast_members_insert on public.brand_cast_members
  for insert with check (public.is_org_member(org_id));
create policy brand_cast_members_update on public.brand_cast_members
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

alter table public.cast_members
  add column brand_cast_member_id uuid references public.brand_cast_members(id);
