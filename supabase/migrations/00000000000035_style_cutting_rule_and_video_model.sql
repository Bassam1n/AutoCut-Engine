-- M5: Scene plan step needs two things the style data never got
-- backfilled with when seed_styles.sql was first written (its own
-- comment said so explicitly: "no models exist in the registry
-- until M3/M4 seed the kie.ai/fal.ai adapters; backfill then" — M3/
-- M4 did seed the registry, but the backfill itself was never done):
--
-- 1. default_video_model_id, so scene duration estimates can be
--    clamped to "the chosen video model's allowed range" per spec
--    §5.4 step 3. Backfilled to kling-v3-pro-i2v (fal), the widest
--    duration range available (3-10s) of the two seeded video
--    models.
-- 2. A cutting_rule in the existing (until now unused) defaults
--    jsonb column: 'fast_cut' (~1 sentence per scene) or
--    'whole_take' (keep full takes, for UGC-paced styles). Added to
--    jsonb rather than a new column since defaults exists exactly
--    for this kind of per-style config.

update public.styles
set default_video_model_id = (
  select m.id from public.models m where m.name = 'kling-v3-pro-i2v'
)
where org_id is null and default_video_model_id is null;

update public.styles
set defaults = defaults || '{"cutting_rule": "whole_take"}'::jsonb
where org_id is null and name in ('Creator UGC', 'Lifestyle B-Roll', 'Creator Swap');

update public.styles
set defaults = defaults || '{"cutting_rule": "fast_cut"}'::jsonb
where org_id is null and name not in ('Creator UGC', 'Lifestyle B-Roll', 'Creator Swap');
