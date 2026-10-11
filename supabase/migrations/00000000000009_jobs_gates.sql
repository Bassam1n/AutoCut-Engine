-- M1: jobs, phase_runs, gates, fallback_events. Spec §4 data model, §2
-- rules 3/4/7 — the most load-bearing tables in the schema:
--
-- Rule 4 ("gates are rows"): only a signed-in human session can resolve a
-- gate. The browser role gets SELECT on gates (so the UI can render the
-- approval card) but NO insert/update/delete policy at all — resolving a
-- gate goes exclusively through the decide_gate() security-definer RPC
-- (written in a later migration), which re-reads the gate row itself and
-- never trusts a client-supplied payload. This is enforced here at the
-- table level, not just by convention in app code.
--
-- Rule 7 (idempotent/resumable): jobs carries idempotency_key and
-- external_task_id so a retry can check an existing provider task instead
-- of submitting (and paying for) a new one.
--
-- Rule 3 (no silent fallbacks): fallback_events is append-only from the
-- browser's perspective — visible, never editable, so a substitution is
-- always a durable, readable record.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid references public.ads(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (
    status in (
      'queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs_human'
    )
  ),
  idempotency_key text not null,
  external_task_id text,
  provider text,
  attempts integer not null default 0,
  cancel_requested boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

-- Browser role can read jobs (needed for progress UI / Realtime) and can
-- request cancellation (the one allowed mutation — flips cancel_requested,
-- never status/payload/external_task_id directly). Everything else about
-- a job's lifecycle is written by the workflow engine under the service
-- role.
create policy jobs_select on public.jobs
  for select using (public.is_org_member(org_id));

create table public.phase_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  phase text not null,
  status text not null default 'running' check (
    status in ('running', 'done', 'failed', 'skipped', 'stale')
  ),
  input_hash text,
  model text,
  prompt_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

alter table public.phase_runs enable row level security;

create policy phase_runs_select on public.phase_runs
  for select using (public.is_org_member(org_id));

create table public.gates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  phase text not null,
  kind text not null,
  actor text not null check (actor in ('editor', 'agent')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'needs_human')
  ),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.gates enable row level security;

-- Browser role can read gates (renders the approval card) but has no
-- insert/update/delete policy whatsoever. Resolving a gate — including
-- the two-simultaneous-click race from the M9 done-when list — happens
-- exclusively inside decide_gate(), which does its own row locking and
-- is the only thing with write access to this table besides the
-- workflow engine (service role) creating the gate in the first place.
create policy gates_select on public.gates
  for select using (public.is_org_member(org_id));

create table public.fallback_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  phase text not null,
  intended text not null,
  actual text not null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.fallback_events enable row level security;

-- Read-only from the browser's perspective, same reasoning as gates: a
-- fallback must be a durable, visible fact the editor can always see,
-- never something the client can edit or suppress after the fact.
create policy fallback_events_select on public.fallback_events
  for select using (public.is_org_member(org_id));
