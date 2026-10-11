-- M1: ads, concepts, cast_members, scenes, assets. Spec §4 core production
-- tables. Browser role can select/insert/update its org's rows for
-- editor-authored fields (brief, scene copy/visual edits per §4). Asset
-- *creation* in practice comes from the workflow engine / provider
-- callbacks using the service role, but the browser role still needs
-- select so Realtime subscriptions and the UI can read them.

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  product_id uuid references public.products(id),
  style_id uuid references public.styles(id),
  mode text not null check (mode in ('studio', 'autopilot')),
  brief jsonb not null default '{}'::jsonb,
  plan_locked boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ads_set_updated_at
  before update on public.ads
  for each row execute function public.set_updated_at();

alter table public.ads enable row level security;

create policy ads_select on public.ads
  for select using (public.is_org_member(org_id));
create policy ads_insert on public.ads
  for insert with check (public.is_org_member(org_id));
create policy ads_update on public.ads
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- concepts: one row per ad (not one per concept option — spec §4 shows
-- `options (jsonb)` holding all three pitched directions plus
-- `selected_idx` and `locked_cast`).
create table public.concepts (
  ad_id uuid primary key references public.ads(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  options jsonb not null default '[]'::jsonb,
  selected_idx integer,
  locked_cast jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger concepts_set_updated_at
  before update on public.concepts
  for each row execute function public.set_updated_at();

alter table public.concepts enable row level security;

create policy concepts_select on public.concepts
  for select using (public.is_org_member(org_id));
create policy concepts_insert on public.concepts
  for insert with check (public.is_org_member(org_id));
create policy concepts_update on public.concepts
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.cast_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  name text not null,
  description text,
  ref_asset_id uuid,
  sheet_asset_id uuid,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cast_members_set_updated_at
  before update on public.cast_members
  for each row execute function public.set_updated_at();

alter table public.cast_members enable row level security;

create policy cast_members_select on public.cast_members
  for select using (public.is_org_member(org_id));
create policy cast_members_insert on public.cast_members
  for insert with check (public.is_org_member(org_id));
create policy cast_members_update on public.cast_members
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  idx integer not null,
  hook_group text check (
    hook_group in ('hook_1', 'hook_2', 'hook_3', 'body', 'cta')
  ),
  copy text not null default '',
  visual text not null default '',
  product_id uuid references public.products(id),
  duration_s numeric(6, 2),
  route text check (
    route in ('stock-friendly', 'generated', 'overlay-only', 'hybrid')
  ),
  notes jsonb not null default '{}'::jsonb,
  speaker text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger scenes_set_updated_at
  before update on public.scenes
  for each row execute function public.set_updated_at();

alter table public.scenes enable row level security;

create policy scenes_select on public.scenes
  for select using (public.is_org_member(org_id));
create policy scenes_insert on public.scenes
  for insert with check (public.is_org_member(org_id));
create policy scenes_update on public.scenes
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  kind text not null check (
    kind in (
      'image', 'last_frame', 'video', 'broll', 'vo', 'caption',
      'overlay', 'final'
    )
  ),
  version integer not null default 1,
  archived boolean not null default false,
  storage_path text not null,
  source text,
  qa jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.assets enable row level security;

-- Browser role can read every asset in its org (needed for the UI/
-- Realtime), but inserts/updates are service-role only (the workflow
-- engine and provider-poll steps write assets, never the browser
-- directly) — this is the one production table where even the editor
-- doesn't get a direct insert policy, since "generate" always goes
-- through a job, never a raw table write.
create policy assets_select on public.assets
  for select using (public.is_org_member(org_id));

alter table public.cast_members
  add constraint cast_members_ref_asset_fk
  foreign key (ref_asset_id) references public.assets(id);
alter table public.cast_members
  add constraint cast_members_sheet_asset_fk
  foreign key (sheet_asset_id) references public.assets(id);
