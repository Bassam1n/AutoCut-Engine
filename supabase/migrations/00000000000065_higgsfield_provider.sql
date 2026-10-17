-- Higgsfield Cloud API as an image/video provider. Its credential is a
-- key ID plus a secret (sent as "Authorization: Key ID:SECRET"); both
-- are stored together as one vault secret value "ID:SECRET", so the
-- existing save/get secret RPCs work unchanged. Only the provider
-- allow-lists on org_secrets/brand_secrets need the new value.
--
-- The secret RPCs (save_*_secret, get_*_secret_value, list_*,
-- mark_*_verified) don't enumerate providers, so none of them change
-- here and migration 064's grants/revokes stay exactly as they were.

alter table public.org_secrets drop constraint org_secrets_provider_check;
alter table public.org_secrets add constraint org_secrets_provider_check check (
  provider in (
    'anthropic', 'kie', 'fal', 'xai', 'elevenlabs',
    'twelvelabs', 'heygen', 'pexels', 'higgsfield'
  )
);

alter table public.brand_secrets drop constraint brand_secrets_provider_check;
alter table public.brand_secrets add constraint brand_secrets_provider_check check (
  provider in (
    'anthropic', 'kie', 'fal', 'xai', 'elevenlabs',
    'twelvelabs', 'heygen', 'pexels', 'higgsfield'
  )
);
