-- M5: price_table seed, needed now that cast reference image
-- generation actually records spend. Spec §4 labels this table
-- "estimates, labelled as such" — fal.ai's documented FLUX.1 [dev]
-- price is $0.025 per megapixel; a portrait_4_3 generation at
-- fal.ai's default resolution is roughly 1 megapixel, so "per_image"
-- here is that per-megapixel price applied to one generation, not a
-- guessed number.
--
-- The kie.ai rows below are the user's own pasted pricing table
-- (kie.ai's real published per-model price at the lowest/default
-- resolution tier each model offers — the tier our registry's
-- parameter_schema defaults to when a resolution isn't explicitly
-- chosen). These fixed a real bug: image generation on any kie.ai
-- model was recording $0.0000 spend, since price_table had no row
-- for any kie model and record_spend_event() was called with
-- usd_est defaulting to 0 rather than failing loudly.
--
-- Not a numbered migration — re-runnable content, same pattern as
-- seed_styles.sql/seed_models.sql/seed_prompts.sql.

insert into public.price_table (provider, model, unit, usd)
values
  ('fal', 'fal-ai/flux/dev', 'per_image', 0.025),
  ('kie', 'google/nano-banana', 'per_image', 0.02),
  ('kie', 'nano-banana-2', 'per_image', 0.04),
  ('kie', 'gpt-image-2-5-flare-text-to-image', 'per_image', 0.03),
  ('kie', 'gpt-image-2-5-sunburst-text-to-image', 'per_image', 0.03),
  ('kie', 'grok-imagine/image-to-image', 'per_image', 0.02)
on conflict (provider, model, unit) do update
  set usd = excluded.usd,
      updated_at = now();

-- Video model prices, same user-provided pricing table, seeded now
-- even though no video-generation code path calls record_spend_event
-- yet (that's a later milestone) — avoids the exact same "price_table
-- has no row, spend silently records as $0.0000" bug the moment video
-- generation does get built. Each row uses that model's 720p,
-- no-native-audio base tier (the cheapest tier each model actually
-- offers), billed per_second where the model bills by duration or
-- per_video where it bills as a flat per-generation cost — matching
-- how each model is actually billed by kie.ai, not a single
-- invented unit applied to everything.
insert into public.price_table (provider, model, unit, usd)
values
  ('kie', 'kling-3.0/video', 'per_second', 0.07),
  ('kie', 'minimax-h3/image-to-video', 'per_second', 0.04),
  ('kie', 'bytedance/seedance-2', 'per_second', 0.205),
  ('kie', 'bytedance/seedance-2-5', 'per_second', 0.19),
  ('kie', 'gemini-omni-video', 'per_video', 0.84),
  ('kie', 'veo3_lite', 'per_video', 0.15),
  ('kie', 'v3-api', 'per_video', 0.30),
  ('kie', 'veo3_quality', 'per_video', 1.25)
on conflict (provider, model, unit) do update
  set usd = excluded.usd,
      updated_at = now();
