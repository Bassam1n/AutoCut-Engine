-- M1: styles, models, model_providers. Spec §4, §5.3.
-- styles.org_id is nullable: null means a platform-seeded style visible to
-- every org (spec §4: "org_id (null for platform seeds)"). models and
-- model_providers are platform-wide (no org_id at all) — a new model
-- doesn't belong to any one org.

create table public.styles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  name text not null,
  description text,
  categories text[] not null default '{}',
  masterprompt text,
  default_image_model_id uuid,
  default_video_model_id uuid,
  defaults jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger styles_set_updated_at
  before update on public.styles
  for each row execute function public.set_updated_at();

alter table public.styles enable row level security;

-- Visible if it's a platform seed (org_id is null) OR belongs to the
-- caller's own org.
create policy styles_select on public.styles
  for select using (
    org_id is null or public.is_org_member(org_id)
  );
-- Orgs may only create/edit their own styles, never platform seeds.
create policy styles_insert on public.styles
  for insert with check (
    org_id is not null and public.is_org_member(org_id)
  );
create policy styles_update on public.styles
  for update using (
    org_id is not null and public.is_org_member(org_id)
  )
  with check (
    org_id is not null and public.is_org_member(org_id)
  );

create table public.models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  capability text not null check (capability in ('image', 'video', 'audio')),
  active boolean not null default true,
  prompt_guide text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger models_set_updated_at
  before update on public.models
  for each row execute function public.set_updated_at();

alter table public.models enable row level security;

-- Platform-wide read-only catalog: every authenticated member of any org
-- can read it, nobody writes it from the browser (model registry changes
-- go through a service-role migration/seed, not end-user action).
create policy models_select_authenticated on public.models
  for select using (auth.role() = 'authenticated');

create table public.model_providers (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.models(id) on delete cascade,
  provider text not null,
  endpoint text not null,
  parameter_schema jsonb not null default '{}'::jsonb,
  price_rule jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger model_providers_set_updated_at
  before update on public.model_providers
  for each row execute function public.set_updated_at();

alter table public.model_providers enable row level security;

create policy model_providers_select_authenticated on public.model_providers
  for select using (auth.role() = 'authenticated');

alter table public.styles
  add constraint styles_default_image_model_fk
  foreign key (default_image_model_id) references public.models(id);
alter table public.styles
  add constraint styles_default_video_model_fk
  foreign key (default_video_model_id) references public.models(id);
