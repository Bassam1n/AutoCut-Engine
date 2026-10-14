-- Access requests from the marketing site (autocutengine.app).
-- Rows are inserted by the app's /api/access-request route using the
-- service role (the visitor is anonymous, so there is no RLS path for
-- them); platform admins read and work the queue from /platform-admin.

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  agency text not null,
  name text not null,
  email text not null,
  editors integer,
  note text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.access_requests enable row level security;

create policy "platform admins read access requests"
  on public.access_requests for select
  using (public.is_platform_admin());

create policy "platform admins update access requests"
  on public.access_requests for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
