-- Persists which Studio step an ad is actually on, so reopening the ad
-- (new tab, closed laptop, different device) resumes exactly where the
-- editor left off instead of re-guessing from scene/script state.
--
-- initialStep() in studio-canvas.tsx previously inferred the step
-- purely from ad.plan_locked/scenes.length/scripts — a heuristic with
-- a hard ceiling at "concept" that never accounted for real progress
-- into Storyboard or Scene images, so a reload after reaching either
-- of those steps silently bounced the editor back to Concept & cast.
-- Nullable: existing ads have no recorded step yet, so the app falls
-- back to the old heuristic exactly once per ad until the first real
-- step change writes a value here.
alter table public.ads add column current_step text check (
  current_step in (
    'scripts', 'brief', 'dial_in', 'plan', 'concept', 'storyboard', 'scene_images'
  )
);
