-- Experimental "Connect Higgsfield account": the OAuth tokens for a
-- client's higgsfield.ai login (so generation could spend their plan
-- credits) are stored as the brand secret "higgsfield_plan", a JSON
-- value {clientId, accessToken, refreshToken, expiresAt}, through the
-- same save/get secret RPCs as every API key. Same constraint swap as
-- migration 065; no RPC or grant changes.

alter table public.org_secrets drop constraint org_secrets_provider_check;
alter table public.org_secrets add constraint org_secrets_provider_check check (
  provider in (
    'anthropic', 'kie', 'fal', 'xai', 'elevenlabs',
    'twelvelabs', 'heygen', 'pexels', 'higgsfield', 'higgsfield_plan'
  )
);

alter table public.brand_secrets drop constraint brand_secrets_provider_check;
alter table public.brand_secrets add constraint brand_secrets_provider_check check (
  provider in (
    'anthropic', 'kie', 'fal', 'xai', 'elevenlabs',
    'twelvelabs', 'heygen', 'pexels', 'higgsfield', 'higgsfield_plan'
  )
);
