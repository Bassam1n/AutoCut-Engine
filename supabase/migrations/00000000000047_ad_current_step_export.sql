-- Fixes a pre-existing gap: migration 40's check constraint on
-- ads.current_step never included 'voiceover' or 'scene_videos', even
-- though both steps were added to the Studio stepper afterward and
-- the app has been trying to write them via saveCurrentStep() ever
-- since (silently failing — the write errors, current_step just never
-- updates past 'scene_images' for an ad that reaches either step).
-- Also adds the new final 'export' step in the same migration rather
-- than filing this as a separate fix, since both are the same
-- "current_step's allowed values are stale" problem.
alter table public.ads drop constraint if exists ads_current_step_check;
alter table public.ads add constraint ads_current_step_check check (
  current_step in (
    'scripts', 'brief', 'dial_in', 'plan', 'concept', 'storyboard',
    'scene_images', 'voiceover', 'scene_videos', 'export'
  )
);
