-- M3: unique constraints so the model registry seed script
-- (supabase/seed_models.sql) can upsert idempotently, same reasoning
-- as 00000000000028's styles_platform_seed_name_key.
--
-- models.name: the registry's own human-readable key (spec's
-- "Registry with capability and per-provider parameter_schema" — one
-- row per distinct model, like z-image or kling-v2-1-pro).
alter table public.models
  add constraint models_name_key unique (name);

-- model_providers: a model can have more than one provider (that's
-- the whole point of the provider-switch escape hatch in spec §5.3),
-- but not the same provider+endpoint twice for the same model.
alter table public.model_providers
  add constraint model_providers_model_provider_endpoint_key
  unique (model_id, provider, endpoint);
