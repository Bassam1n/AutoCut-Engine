-- M6: Scene images. Spec §5.6.
--
-- image_prompt_override: the "sticky prompt override" — the editor
-- can open the exact final prompt a scene's images would be generated
-- from and save a manual override that sticks across regenerations
-- until explicitly reset (null). Nullable, lives on scenes since it's
-- a per-scene setting, not per-asset.
alter table public.scenes add column image_prompt_override text;

-- 'feedback' is a new assets.kind — a minimal version of §5.8's
-- "attached feedback images" reference tier, built now (per explicit
-- request) even though the full feedback/remember system (§5.8) is a
-- later, separate milestone. A feedback image is scene-scoped
-- (ad_id + scene_id both set), uploaded directly by the editor, not
-- Claude-generated — same direct-to-Storage upload pattern as product
-- refs and cast references.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (
  kind in (
    'image', 'last_frame', 'video', 'broll', 'vo', 'caption',
    'overlay', 'final', 'feedback'
  )
);
