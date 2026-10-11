-- M1: spend_events, mcp_tokens, audit_log. Spec §4, §2 rule 9 (spend
-- visible before the click, recorded after), §5.12 (MCP tokens shown
-- once, stored hashed, revocable).

create table public.spend_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid references public.ads(id) on delete cascade,
  provider text not null,
  model text,
  usd_est numeric(12, 6) not null,
  kind text not null,
  created_at timestamptz not null default now()
);

alter table public.spend_events enable row level security;

-- Read-only: editors see spend (that's the whole point of the spend
-- admin screen in §5.10), but every row is written by the workflow
-- engine / provider call wrapper under the service role, never inserted
-- directly by the browser — a client-supplied spend_events row would be
-- a trivial way to fake or hide real cost.
create policy spend_events_select on public.spend_events
  for select using (public.is_org_member(org_id));

-- mcp_tokens: org-scoped remote-MCP bearer tokens. Spec §5.12: "shown
-- once, stored hashed, revocable, with a per-token spend cap." Only
-- token_hash and last4 are ever columns here — the raw token value is
-- never persisted anywhere, consistent with org_secrets' pattern of
-- storing only a pointer/hint, never the secret itself.
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  token_hash text not null,
  last4 text not null,
  spend_cap_usd numeric(10, 2),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_tokens enable row level security;

-- Admins can see which tokens exist for their org (name/last4/revoked
-- status — never the hash itself needs to be read back by the UI, but
-- restricting to admins only, not all members, limits exposure of even
-- the hash and spend cap to those who manage integrations).
create policy mcp_tokens_select_admin on public.mcp_tokens
  for select using (public.is_org_admin(org_id));
-- Revocation is the one direct-write escape hatch: an admin can set
-- revoked_at themselves without waiting on an RPC, since instant
-- revocation matters more here than funneling through one more layer.
-- Token creation still goes through a security-definer RPC (so the
-- plaintext token is only ever returned once, from server-generated
-- randomness, never from a client-supplied value).
create policy mcp_tokens_update_admin_revoke on public.mcp_tokens
  for update using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  target text,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Append-only from the browser's perspective: admins can read the trail,
-- nobody can insert/update/delete directly. Every audited action (gate
-- decisions, key changes, resumes, role changes) writes this table from
-- inside the RPC that performs the action, so the log entry and the
-- action it describes are always written atomically together.
create policy audit_log_select_admin on public.audit_log
  for select using (public.is_org_admin(org_id));
