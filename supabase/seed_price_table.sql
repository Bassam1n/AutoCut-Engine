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

-- (Unused since the API models were replaced by the connected-account
-- 'higgsfield_plan' models, which spend plan credits and have no rows here.)
-- Higgsfield Cloud API prices (read 2026-10-17 from Higgsfield's public
-- pricing at console.higgsfield.ai/pricing, the same data its page
-- loads from dash.higgsfield.ai/api/v2/pricing/models/). Higgsfield
-- publishes these directly in USD, so no credit conversion is needed.
-- Each row is the LIST price (before Higgsfield's current launch
-- discounts of 15-75%) for the most expensive tier the adapter can
-- request, so recorded spend never undercounts:
--   Marketing Studio Flare: token-priced ($0.0126 at 1k low up to
--     $0.7219 at 4k max). The adapter blocks 4k and xhigh/max; $0.084
--     is Higgsfield's own documented per-image estimate for the same
--     GPT Image 2.5 Flare renderer at 2k with reference images (Ads
--     Studio pricing).
--   Grok Image 2.0: $0.04 (1k low) / $0.08 (2k medium) -> 0.08.
--   SOUL V2: $0.0032 (720p) / $0.0057 (1080p); adapter pins 1080p.
--   Ideogram 4.0: flat $0.03.
--   Kling 3.0 Std / Pro i2v: $0.084-0.126 / $0.112-0.168 per second
--     (upper value is with native audio) -> 0.126 / 0.168.
--   Wan 3.0 i2v: $0.05 / 0.10 / 0.20 per second at 480p / 720p /
--     1080p; adapter pins 1080p -> 0.20.
--   MiniMax H3 i2v (2K only): $0.13 per second.
--   Hailuo 2.3 Std i2v: $0.0467 (6s) / $0.056 (10s) per second -> 0.056.
--   HappyHorse 1.1 i2v: $0.14 / 0.18 per second at 720p / 1080p;
--     adapter pins 1080p -> 0.18.
-- Seedance 2.x and Cinema Studio are not exposed yet: Higgsfield only
-- publishes their lowest and highest tiers, not the 720p/1080p rate.
insert into public.price_table (provider, model, unit, usd)
values
  ('higgsfield', 'marketing-studio/image/flare', 'per_image', 0.084),
  ('higgsfield', 'xai/grok-imagine-image-2.0', 'per_image', 0.08),
  ('higgsfield', 'higgsfield-ai/soul/v2/standard', 'per_image', 0.0057),
  ('higgsfield', 'ideogram/v4.0', 'per_image', 0.03),
  ('higgsfield', 'kling-video/v3.0/std/image-to-video', 'per_second', 0.126),
  ('higgsfield', 'kling-video/v3.0/pro/image-to-video', 'per_second', 0.168),
  ('higgsfield', 'alibaba/wan-3.0/image-to-video', 'per_second', 0.20),
  ('higgsfield', 'minimax/h3/image-to-video', 'per_second', 0.13),
  ('higgsfield', 'minimax/hailuo-2.3/standard/image-to-video', 'per_second', 0.056),
  ('higgsfield', 'alibaba/happy-horse/v1.1/image-to-video', 'per_second', 0.18)
on conflict (provider, model, unit) do update
  set usd = excluded.usd,
      updated_at = now();
