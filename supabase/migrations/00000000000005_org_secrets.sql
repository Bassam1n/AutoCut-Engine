-- M1: org_secrets. Spec §2 rule 5: per-org API keys live encrypted in
-- Supabase Vault, never reach the browser, logs, job payloads or Realtime
-- payloads. This table stores ONLY a pointer into Vault plus a last4 hint
-- — the real secret value is never a column on this table.
--
-- Done-when test (M1): "The browser role cannot write gates.status, jobs,
-- assets or org_secrets" — this table has RLS enabled with NO policies at
-- all for the anon/authenticated role, so every direct query from the
-- browser role returns zero rows and every write is rejected. All access
-- goes through security-definer RPCs (save_org_secret, verify_org_secret)
-- that never SELECT the vault_secret_id back to the caller.

create table public.org_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
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
  unique (org_id, provider)
);

create trigger org_secrets_set_updated_at
  before update on public.org_secrets
  for each row execute function public.set_updated_at();

alter table public.org_secrets enable row level security;

-- Intentionally no policies: RLS is enabled with zero grants for the
-- browser role, so every row is invisible and every write is refused
-- regardless of org membership. This table is only ever touched by
-- security-definer RPCs running as the function owner, never by a direct
-- table query from apps/web's browser-scoped Supabase client.
