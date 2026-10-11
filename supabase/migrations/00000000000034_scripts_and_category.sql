-- M5: script-first flow per the user's correction — the editor
-- already supplies brand/customer/product context, so the Studio
-- should generate 3 full script variations (hook+body+CTA) up front,
-- with the manual Brief form demoted to a fallback used only when the
-- editor rejects all 3. Ad length is a required input the editor
-- always provides before generation, since script pacing depends on
-- it (a 15s script and a 45s script are not the same length of text
-- cut differently — they're different scripts).
--
-- products.category becomes a fixed enum (was free text) so it can
-- key a platform-wide tone/angle template per category. The old
-- Hermes visual_library category list was checked first (see session
-- history) — it was almost entirely empty placeholders and modeled
-- shot/video-production patterns, not copy tone — so this is a fresh,
-- smaller list sized to actual copy-generation needs, not a port.

alter table public.products
  add column category_v2 text check (
    category_v2 in (
      'supplements', 'skincare', 'fitness', 'pain_relief', 'wearables',
      'home_products', 'apparel', 'beauty', 'food_beverage', 'other'
    )
  );

update public.products set category_v2 = 'other' where category is not null;

alter table public.products drop column category;
alter table public.products rename column category_v2 to category;
alter table public.products rename constraint products_category_v2_check to products_category_check;

-- Platform-wide, admin-editable tone/angle brief per category — prose
-- guidance fed to the script-generation prompt as inspiration, not
-- literal example copy (spec decision: lighter authoring now,
-- upgradeable to real example banks later without a schema change).
create table public.category_templates (
  category text primary key check (
    category in (
      'supplements', 'skincare', 'fitness', 'pain_relief', 'wearables',
      'home_products', 'apparel', 'beauty', 'food_beverage', 'other'
    )
  ),
  tone_notes text not null,
  updated_at timestamptz not null default now()
);

create trigger category_templates_set_updated_at
  before update on public.category_templates
  for each row execute function public.set_updated_at();

alter table public.category_templates enable row level security;

-- Platform-wide reference data, same read/write shape as styles:
-- every org member can read it (needed client-side nowhere yet, but
-- consistent with styles/prompt_versions), writes are service-role
-- only (admin-curated content, not per-org).
create policy category_templates_select on public.category_templates
  for select using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Ad length, captured before script generation. Nullable until the
-- editor sets it (ads existing before this column has no value yet;
-- enforced as "must be set before generating" in application code,
-- not a not-null constraint, since draft ads are created before
-- length is known).
alter table public.ads
  add column target_length_seconds integer check (
    target_length_seconds is null or target_length_seconds > 0
  );

-- One row per generated script variant for an ad. Separate from
-- ads.brief (which stays as the manual-fallback shape) since a
-- generation produces exactly 3 candidates and the editor picks one —
-- that's a one-to-many relationship brief's single-object jsonb
-- can't represent.
create table public.ad_scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  variant_index integer not null check (variant_index in (1, 2, 3)),
  hook text not null,
  body text not null,
  cta text not null,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ad_id, variant_index)
);

alter table public.ad_scripts enable row level security;

create policy ad_scripts_select on public.ad_scripts
  for select using (public.is_org_member(org_id));
-- Insert/update stay editor-writable directly (same shape as brief):
-- generation itself runs through llm.call() server-side using the
-- service role for the Anthropic call, but persisting the 3 results
-- and toggling `selected` are ordinary editor-authored writes, not
-- sensitive enough to require an RPC.
create policy ad_scripts_insert on public.ad_scripts
  for insert with check (public.is_org_member(org_id));
create policy ad_scripts_update on public.ad_scripts
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
