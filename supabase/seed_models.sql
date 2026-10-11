-- M3: model registry seed data. Spec §5.3: "Registry with capability
-- and per-provider parameter_schema. Settings popovers (ratio,
-- quality, count, duration, resolution, audio) render from the
-- schema." Every model and parameter_schema field below comes from
-- each provider's own live API docs, fetched and confirmed before
-- writing this — not guessed. Where a provider's schema genuinely has
-- no such field (e.g. fal.ai's Kling video has no aspect_ratio param
-- at all), it's simply absent here rather than invented.
--
-- Not a numbered migration — like seed_styles.sql, this is re-runnable
-- content, not a one-way schema change. Idempotent via ON CONFLICT
-- against the unique constraints added in
-- 00000000000032_model_providers_unique.sql (run that migration
-- before this script).

insert into public.models (name, capability, active, prompt_guide)
values
  ('z-image', 'image', true, 'Fast text-to-image. Max prompt length not documented by kie.ai; keep prompts concise and concrete.'),
  ('flux-dev', 'image', true, 'FLUX.1 [dev] via fal.ai. Strong prompt adherence at default guidance_scale 3.5; raise for stricter prompt-following, lower for more creative variation.'),
  ('kling-v2-1-pro', 'video', true, 'Image-to-video. Requires a starting image_url — this model cannot generate video from text alone. Max prompt 5000 characters.'),
  ('kling-v3-pro-i2v', 'video', true, 'Image-to-video via fal.ai. Requires start_image_url. Supports multi-shot generation via multi_prompt as an alternative to a single prompt.'),
  ('nano-banana', 'image', true, 'Google Nano Banana via kie.ai. Text-to-image; no reference image input confirmed for this entry point.'),
  ('grok-imagine-i2i', 'image', true, 'Grok Imagine image-to-image via kie.ai. Takes one or more reference images (image_urls) the model edits/recreates from — the model this org''s cast reference generation should use once a kie key is saved.')
on conflict (name) do update
  set capability = excluded.capability,
      active = excluded.active,
      prompt_guide = excluded.prompt_guide;

-- model_providers: parameter_schema is an array of field descriptors
-- — {key, label, type, options?, min?, max?, step?, default?,
-- required?} — general enough to drive a settings popover for any
-- field shape without a different schema format per field type.
insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'z-image',
  '[
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["1:1", "4:3", "3:4", "16:9", "9:16"], "default": "9:16", "required": true},
    {"key": "nsfw_checker", "label": "Content filter", "type": "boolean", "default": false, "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'z-image'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'fal', 'fal-ai/flux/dev',
  '[
    {"key": "image_size", "label": "Size", "type": "enum", "options": ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"], "default": "landscape_4_3", "required": false},
    {"key": "num_images", "label": "Count", "type": "integer", "min": 1, "max": 4, "default": 1, "required": false},
    {"key": "num_inference_steps", "label": "Quality (steps)", "type": "integer", "min": 1, "max": 50, "default": 28, "required": false},
    {"key": "guidance_scale", "label": "Prompt adherence", "type": "number", "min": 0, "max": 10, "step": 0.1, "default": 3.5, "required": false},
    {"key": "output_format", "label": "Format", "type": "enum", "options": ["jpeg", "png"], "default": "jpeg", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'flux-dev'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'kling/v2-1-pro',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "enum", "options": ["5", "10"], "default": "5", "required": true},
    {"key": "cfg_scale", "label": "Prompt adherence", "type": "number", "min": 0, "max": 1, "step": 0.1, "default": 0.5, "required": false},
    {"key": "negative_prompt", "label": "Avoid", "type": "string", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'kling-v2-1-pro'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'fal', 'fal-ai/kling-video/v3/pro/image-to-video',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "enum", "options": ["3", "4", "5", "6", "7", "8", "9", "10"], "default": "5", "required": false},
    {"key": "generate_audio", "label": "Audio", "type": "boolean", "default": true, "required": false},
    {"key": "shot_type", "label": "Shot type", "type": "enum", "options": ["customize", "intelligent"], "default": "customize", "required": false},
    {"key": "cfg_scale", "label": "Prompt adherence", "type": "number", "default": 0.5, "required": false},
    {"key": "negative_prompt", "label": "Avoid", "type": "string", "default": "blur, distort, and low quality", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'kling-v3-pro-i2v'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

-- Confirmed against a real kie.ai request payload the user provided
-- (not guessed): {"model": "google/nano-banana", "input": {"prompt",
-- "output_format", "aspect_ratio"}}. No reference-image field shown
-- in that example — treated as text-to-image only until a payload
-- with an image input is confirmed.
insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'google/nano-banana',
  '[
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["1:1", "4:3", "3:4", "16:9", "9:16"], "default": "1:1", "required": false},
    {"key": "output_format", "label": "Format", "type": "enum", "options": ["png", "jpeg"], "default": "png", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'nano-banana'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

-- Confirmed against a real kie.ai request payload the user provided:
-- {"model": "grok-imagine/image-to-image", "input": {"prompt",
-- "image_urls"}} — no aspect_ratio field in this example, reference
-- images go in image_urls (an array), which is exactly what
-- SubmitParams.referenceImageUrls now maps onto in KieAdapter.
insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'grok-imagine/image-to-image',
  '[]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'grok-imagine-i2i'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;
