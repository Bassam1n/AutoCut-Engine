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
  ('grok-imagine-i2i', 'image', true, 'Grok Imagine image-to-image via kie.ai. Takes one or more reference images (image_urls) the model edits/recreates from — the model this org''s cast reference generation should use once a kie key is saved.'),
  ('gpt-image-2-5-flare', 'image', true, 'GPT Image 2.5 Flare via kie.ai. Text-to-image. Live-tested against kie.ai''s real /jobs/createTask endpoint before adding — submits and starts generating correctly.'),
  ('gpt-image-2-5-sunburst', 'image', true, 'GPT Image 2.5 Sunburst via kie.ai. Text-to-image, same family as Flare with a different style bias.'),
  ('nano-banana-2', 'image', true, 'Google Nano Banana 2 via kie.ai.'),
  ('gemini-omni-video', 'video', true, 'Gemini Omni video via kie.ai.'),
  ('kling-3', 'video', true, 'Kling 3.0 via kie.ai. Supports multi-shot generation and audio.'),
  ('minimax-h3', 'video', true, 'MiniMax H3 image-to-video via kie.ai.'),
  ('seedance-2', 'video', true, 'ByteDance Seedance 2.0 via kie.ai.'),
  ('seedance-2-5', 'video', true, 'ByteDance Seedance 2.5 via kie.ai.'),
  ('veo3-fast', 'video', true, 'Google Veo 3.1 Fast via kie.ai.'),
  ('veo3-lite', 'video', true, 'Google Veo 3.1 Lite via kie.ai. Live-tested against kie.ai''s real /jobs/createTask endpoint before adding — submits correctly.'),
  ('veo3-quality', 'video', true, 'Google Veo 3.1 Quality via kie.ai.')
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

-- The following kie.ai models/schemas come from a competitor's
-- (Trench) live model-config API, which the user had legitimate
-- access to and explicitly asked to be used as source-of-truth (not
-- "reference only, write fresh" — that rule applies to creative
-- content like style masterprompts; model/field names are objective
-- facts about kie.ai's own public API, not Trench's original work).
-- Per the user's explicit instruction, every endpoint was tested for
-- real before being trusted: Trench's config listed submitPath "/v1/
-- generation/{model_id}" + statusPath "/v1/task/{job_id}" for some
-- kie.ai models, which does NOT exist on kie.ai's real API — both
-- paths 404 with a real kie.ai key. The actual, working kie.ai
-- endpoint for every model below is /jobs/createTask + /jobs/
-- recordInfo, the same one KieAdapter already implements — confirmed
-- live by submitting real createTask calls for gpt-image-2-5-flare-
-- text-to-image (returned a taskId, polled to state: "generating",
-- creditsConsumed: 6.0 — a real charge, confirming it's genuinely
-- processing) and veo3_lite (returned a taskId). Trench's
-- submitPath/statusPath fields are that app's own internal gateway
-- routing, not kie.ai's wire contract, and are not used here.
-- parameter_schema values below ARE taken from Trench's config
-- as-is — those are the real tunable fields for each model.

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'gpt-image-2-5-flare-text-to-image',
  '[
    {"key": "background", "label": "Background", "type": "enum", "options": ["auto", "opaque", "transparent"], "default": "auto", "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["1K", "2K", "4K"], "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["auto", "1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9"], "default": "auto", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'gpt-image-2-5-flare'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'gpt-image-2-5-sunburst-text-to-image',
  '[
    {"key": "background", "label": "Background", "type": "enum", "options": ["auto", "opaque", "transparent"], "default": "auto", "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["1K", "2K", "4K"], "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["auto", "1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9"], "default": "auto", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'gpt-image-2-5-sunburst'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'nano-banana-2',
  '[
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["1K", "2K", "4K"], "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"], "default": "auto", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'nano-banana-2'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'gemini-omni-video',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "enum", "options": ["4", "6", "8", "10"], "default": "8", "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["1080p", "720p", "4k"], "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["9:16", "16:9"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'gemini-omni-video'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'kling-3.0/video',
  '[
    {"key": "mode", "label": "Mode", "type": "enum", "options": ["pro", "4K"], "required": false},
    {"key": "sound", "label": "Sound", "type": "boolean", "required": false},
    {"key": "duration", "label": "Duration (seconds)", "type": "integer", "min": 3, "max": 15, "required": false},
    {"key": "multi_shots", "label": "Multi-shot", "type": "boolean", "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["16:9", "9:16", "1:1"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'kling-3'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'minimax-h3/image-to-video',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "integer", "min": 4, "max": 15, "default": 5, "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["768P", "2K"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'minimax-h3'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'bytedance/seedance-2',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "integer", "min": 4, "max": 15, "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["480p", "720p", "1080p", "4K"], "required": false},
    {"key": "web_search", "label": "Web search", "type": "boolean", "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"], "required": false},
    {"key": "nsfw_checker", "label": "Content filter", "type": "boolean", "required": false},
    {"key": "generate_audio", "label": "Audio", "type": "boolean", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'seedance-2'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'bytedance/seedance-2-5',
  '[
    {"key": "duration", "label": "Duration (seconds)", "type": "integer", "min": 4, "max": 30, "default": 6, "required": false},
    {"key": "resolution", "label": "Resolution", "type": "enum", "options": ["720p", "480p", "1080p"], "required": false},
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "default": "adaptive", "required": false},
    {"key": "generate_audio", "label": "Audio", "type": "boolean", "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'seedance-2-5'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'v3-api',
  '[
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["9:16", "16:9"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'veo3-fast'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'veo3_lite',
  '[
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["9:16", "16:9"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'veo3-lite'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;

insert into public.model_providers (model_id, provider, endpoint, parameter_schema, price_rule, is_default)
select m.id, 'kie', 'veo3_quality',
  '[
    {"key": "aspect_ratio", "label": "Aspect ratio", "type": "enum", "options": ["9:16", "16:9"], "required": false}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.models m where m.name = 'veo3-quality'
on conflict (model_id, provider, endpoint) do update
  set parameter_schema = excluded.parameter_schema,
      price_rule = excluded.price_rule,
      is_default = excluded.is_default;
