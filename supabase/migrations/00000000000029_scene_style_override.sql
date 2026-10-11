-- M2/M5-adjacent: per-scene style override. ads.style_id
-- (00000000000008_ads_scenes_assets.sql) sets the style for the whole
-- ad, but an editor legitimately wants a different look for one scene
-- within an otherwise consistent ad — a 3D hook into a UGC body is
-- the exact example this was requested for. null means "inherit the
-- ad's style," which stays the overwhelmingly common case; this is an
-- override, not a second required choice on every scene.
--
-- No RLS changes needed — scenes already has insert/update policies
-- for the browser role (00000000000008), and style_id read access is
-- already covered by styles' own RLS (visible if it's a platform seed
-- or belongs to the caller's org), so a scene referencing a style the
-- org can't see is already impossible to produce from the browser.
alter table public.scenes
  add column style_id uuid references public.styles(id);
