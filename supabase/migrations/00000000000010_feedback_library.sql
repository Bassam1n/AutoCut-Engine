-- M1: feedback_events, rules, library_items. Spec §4, §5.8, §5.9.

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  target text not null check (target in ('image', 'video', 'last_frame')),
  mode text not null check (mode in ('tweak', 'rework')),
  text text not null,
  remember boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.feedback_events enable row level security;

create policy feedback_events_select on public.feedback_events
  for select using (public.is_org_member(org_id));
create policy feedback_events_insert on public.feedback_events
  for insert with check (public.is_org_member(org_id));

-- rules: distilled DO/AVOID rules from remembered feedback. Spec §5.8:
-- "A rules screen lets admins read, edit, pause and delete them." —
-- regular editors can read (rules are applied silently during generation,
-- editors should be able to see why), only admins can edit/pause/delete.
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  scope text not null check (scope in ('org', 'brand', 'style', 'product')),
  scope_id uuid,
  kind text not null check (kind in ('do', 'avoid')),
  text text not null,
  confidence numeric(4, 3) not null default 0.5,
  reinforced_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger rules_set_updated_at
  before update on public.rules
  for each row execute function public.set_updated_at();

alter table public.rules enable row level security;

create policy rules_select on public.rules
  for select using (public.is_org_member(org_id));
create policy rules_admin_update on public.rules
  for update using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));
create policy rules_admin_delete on public.rules
  for delete using (public.is_org_admin(org_id));

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid references public.brands(id),
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger library_items_set_updated_at
  before update on public.library_items
  for each row execute function public.set_updated_at();

alter table public.library_items enable row level security;

create policy library_items_select on public.library_items
  for select using (public.is_org_member(org_id));
create policy library_items_insert on public.library_items
  for insert with check (public.is_org_member(org_id));
create policy library_items_update on public.library_items
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy library_items_delete on public.library_items
  for delete using (public.is_org_member(org_id));
