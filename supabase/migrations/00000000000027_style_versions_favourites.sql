-- M2/M3-adjacent: fills three gaps spec §5.3 names but M1 never built —
-- "masterprompt (versioned)", a picker gallery with "preview images,
-- category tabs, search, favourites and recents."
--
-- preview_image_url: added directly to styles (not a separate table —
-- one style has one current preview image, same shape as
-- brands.logo_url). Points at the `library` storage bucket or an
-- external URL; nothing here enforces which, same as logo_url.
alter table public.styles
  add column preview_image_url text;

-- style_versions: mirrors prompt_versions' exact pattern
-- (00000000000011_prompts_pricing.sql) — version history keyed by
-- (parent_id, version), an `active` flag marking the current one, no
-- FK back-pointer from the parent row. styles.masterprompt stays as
-- the fast-read "current version" text (every existing and future
-- read of a style's masterprompt already goes through styles directly,
-- same as prompt_versions.active rows are read directly rather than
-- joined) — style_versions exists for history/audit/rollback, not as
-- the primary read path.
create table public.style_versions (
  id uuid primary key default gen_random_uuid(),
  style_id uuid not null references public.styles(id) on delete cascade,
  version integer not null,
  masterprompt text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (style_id, version)
);

alter table public.style_versions enable row level security;

-- Same visibility rule as styles itself: a platform seed's version
-- history is visible to everyone, an org's own style's history only
-- to that org.
create policy style_versions_select on public.style_versions
  for select using (
    exists (
      select 1 from public.styles s
      where s.id = style_versions.style_id
        and (s.org_id is null or public.is_org_member(s.org_id))
    )
  );

-- user_style_favourites: per-user, not per-org — two editors in the
-- same org can favourite different styles. No RLS policy keys off
-- org_id for that reason; it keys off auth.uid() directly, same
-- shape as any other "this user's own data" table would.
create table public.user_style_favourites (
  user_id uuid not null references auth.users(id) on delete cascade,
  style_id uuid not null references public.styles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, style_id)
);

alter table public.user_style_favourites enable row level security;

create policy user_style_favourites_select on public.user_style_favourites
  for select using (user_id = auth.uid());
create policy user_style_favourites_insert on public.user_style_favourites
  for insert with check (user_id = auth.uid());
create policy user_style_favourites_delete on public.user_style_favourites
  for delete using (user_id = auth.uid());

-- "Recents" (spec §5.3) deliberately has no table of its own — it's
-- derived from ads.style_id usage (most recent ads per org, grouped by
-- style), not a separately tracked event log. Building that query is
-- picker-UI work, not schema work; nothing to migrate for it here.
