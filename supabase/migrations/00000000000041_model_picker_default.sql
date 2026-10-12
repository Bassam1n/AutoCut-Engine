-- Adds a real "which model should the picker pre-select" flag.
--
-- Every image/video generation UI (concept-cast-step.tsx, scene-
-- images-step.tsx) was defaulting to imageModelOptions[0] — whatever
-- row happened to sort first out of getModelOptions()'s unordered
-- query — which is why z-image (the first-seeded image model) kept
-- showing up pre-selected even though it has an undocumented prompt-
-- length limit that kept failing real generations. models.is_default
-- is the real, explicit answer: exactly one active model per
-- capability should have it set, getModelOptions() orders by it, and
-- every picker defaults to the first row of that ordered result
-- instead of raw insertion order.
alter table public.models add column is_default boolean not null default false;

-- At most one default per capability, enforced at the database level
-- rather than left as an app-code convention that silently drifts.
create unique index models_one_default_per_capability
  on public.models (capability)
  where is_default;
