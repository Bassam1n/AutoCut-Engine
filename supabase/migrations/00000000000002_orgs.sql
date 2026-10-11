-- M1: orgs and org_members tables. RLS is enabled here but policies are
-- added in 00000000000002b_orgs_policies.sql, after is_org_member() exists
-- (00000000000002a_org_helpers.sql) — a policy can't reference a function
-- that isn't created yet, same ordering constraint that affected the
-- original single-file version of this migration.

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  paused boolean not null default false,
  warn_usd numeric(10, 2) not null default 300.00,
  stop_usd numeric(10, 2) not null default 600.00,
  pause_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orgs_set_updated_at
  before update on public.orgs
  for each row execute function public.set_updated_at();

alter table public.orgs enable row level security;

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor')),
  seat_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create trigger org_members_set_updated_at
  before update on public.org_members
  for each row execute function public.set_updated_at();

alter table public.org_members enable row level security;
