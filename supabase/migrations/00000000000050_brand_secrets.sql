-- M-brand-keys: brand_secrets. Real agency feedback: one org serves
-- multiple client brands, and a brand's own ElevenLabs/kie/fal/etc key
-- must only ever be used for that brand's own generations — never
-- shared across the org's other clients. Mirrors org_secrets
-- (00000000000005) exactly in security model: same Vault-pointer
-- pattern, same zero-RLS-policies/service-role-only design, same
-- columns plus brand_id.
--
-- Scoped to (brand_id, provider) rather than (org_id, brand_id,
-- provider) for the unique constraint — a brand only ever belongs to
-- one org (brands.org_id is not null), so brand_id alone already
-- uniquely determines the org; org_id is kept as a column for the same
-- reason org_secrets keeps org_id despite provider alone not being
-- unique org-wide — fast scoped lookups and an explicit FK, not a
-- second source of truth.

create table public.brand_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  provider text not null check (
    provider in (
      'anthropic', 'kie', 'fal', 'xai', 'elevenlabs',
      'twelvelabs', 'heygen', 'pexels'
    )
  ),
  vault_secret_id uuid not null,
  last4 text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, provider)
);

create trigger brand_secrets_set_updated_at
  before update on public.brand_secrets
  for each row execute function public.set_updated_at();

alter table public.brand_secrets enable row level security;

-- Intentionally no policies — same reasoning as org_secrets: every row
-- is invisible and every write is refused to the browser role
-- regardless of org/brand membership, so a key can only ever be
-- touched through the security-definer RPCs below.
