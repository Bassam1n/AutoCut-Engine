-- M1: prompt_versions, price_table. Spec §4 — both platform-wide (no
-- org_id), same pattern as models/model_providers in migration 7:
-- read-only catalog for every authenticated member, written only via
-- service-role migrations/seeds, never end-user action.

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  version integer not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (task, version)
);

alter table public.prompt_versions enable row level security;

create policy prompt_versions_select_authenticated on public.prompt_versions
  for select using (auth.role() = 'authenticated');

create table public.price_table (
  provider text not null,
  model text not null,
  unit text not null,
  usd numeric(12, 6) not null,
  updated_at timestamptz not null default now(),
  primary key (provider, model, unit)
);

alter table public.price_table enable row level security;

create policy price_table_select_authenticated on public.price_table
  for select using (auth.role() = 'authenticated');
