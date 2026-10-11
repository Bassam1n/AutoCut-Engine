-- M5: price_table seed, needed now that cast reference image
-- generation actually records spend. Spec §4 labels this table
-- "estimates, labelled as such" — fal.ai's documented FLUX.1 [dev]
-- price is $0.025 per megapixel; a portrait_4_3 generation at
-- fal.ai's default resolution is roughly 1 megapixel, so "per_image"
-- here is that per-megapixel price applied to one generation, not a
-- guessed number.
--
-- Not a numbered migration — re-runnable content, same pattern as
-- seed_styles.sql/seed_models.sql/seed_prompts.sql.

insert into public.price_table (provider, model, unit, usd)
values ('fal', 'fal-ai/flux/dev', 'per_image', 0.025)
on conflict (provider, model, unit) do update
  set usd = excluded.usd,
      updated_at = now();
