-- M1: brands, customers, products, product_refs, product_specs.
-- Spec §4 data model, §5.2 feature spec. These are editor-authored content
-- tables: browser role gets select + insert/update on org-scoped rows,
-- per spec §4's opening paragraph ("browser role gets select on its org's
-- rows and insert or update only on user-authored content"). No deletes
-- from the browser role — archival/soft-delete patterns apply per rule 8.

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  logo_url text,
  brand_context jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

alter table public.brands enable row level security;

create policy brands_select on public.brands
  for select using (public.is_org_member(org_id));
create policy brands_insert on public.brands
  for insert with check (public.is_org_member(org_id));
create policy brands_update on public.brands
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

create policy customers_select on public.customers
  for select using (public.is_org_member(org_id));
create policy customers_insert on public.customers
  for insert with check (public.is_org_member(org_id));
create policy customers_update on public.customers
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  category text,
  what_it_is text,
  url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

create policy products_select on public.products
  for select using (public.is_org_member(org_id));
create policy products_insert on public.products
  for insert with check (public.is_org_member(org_id));
create policy products_update on public.products
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.product_refs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('photo', 'angle', 'alternate')),
  name text,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.product_refs enable row level security;

create policy product_refs_select on public.product_refs
  for select using (public.is_org_member(org_id));
create policy product_refs_insert on public.product_refs
  for insert with check (public.is_org_member(org_id));
create policy product_refs_update on public.product_refs
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- product_specs: Claude-vision-derived structural description. Spec §5.2:
-- "versioned and human-editable. Photos outrank text whenever the two
-- disagree." Editors can edit the `spec` field (source: 'human') but the
-- version/approval lineage is append-only from the browser's perspective —
-- a new spec is a new row, never an overwrite, consistent with rule 8
-- (archive, never delete/overwrite).
create table public.product_specs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  version integer not null,
  spec jsonb not null,
  source text not null check (source in ('vision', 'human')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, version)
);

alter table public.product_specs enable row level security;

create policy product_specs_select on public.product_specs
  for select using (public.is_org_member(org_id));
create policy product_specs_insert on public.product_specs
  for insert with check (public.is_org_member(org_id));
-- Approval toggle is the one allowed update (human review of a vision-
-- generated spec); the spec/version/source fields themselves are
-- immutable once written — correcting content means inserting a new
-- version, not editing this one.
create policy product_specs_update_approval on public.product_specs
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
