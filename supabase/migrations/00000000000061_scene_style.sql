-- Per-scene style override. Real ads mix looks within one ad (UGC talking
-- head, then a 3D anatomy cutaway, then a product packshot), so a scene
-- may now carry its own style. NULL = inherit the ad's style (ads.style_id),
-- which keeps every existing scene behaving exactly as before.
-- The column already existed in production (added outside the migration
-- history, unused, all NULL); `if not exists` makes this file match it.
alter table public.scenes
  add column if not exists style_id uuid references public.styles(id) on delete set null;

comment on column public.scenes.style_id is
  'Optional per-scene style; NULL inherits ads.style_id. Read via the effective-style helper (scene-style.ts).';
