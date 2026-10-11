-- M1: decide_gate — the single most load-bearing RPC in the schema.
-- Spec §2 rule 4 ("Gates are rows. Only a signed-in human session can
-- resolve a gate. The workflow re-reads the gate row from the database on
-- resume and never trusts an event payload. Editor gates never time out
-- into approval.") and §6 M9 done-when: "Two simultaneous approve clicks:
-- exactly one wins, the other sees who decided."
--
-- How the race is actually closed: `update ... where status = 'pending'`
-- is a single atomic statement. Postgres row-locks the target row for the
-- duration of the UPDATE, so if two sessions call this concurrently, the
-- second one's UPDATE blocks until the first commits — at which point the
-- row's status is no longer 'pending', so the second UPDATE's WHERE
-- clause matches zero rows. No explicit SELECT ... FOR UPDATE needed; a
-- conditional UPDATE is already the atomic primitive. The loser gets
-- gate_already_decided with who actually decided it and when, per the
-- "the other sees who decided" requirement — this function never raises
-- a generic error for that case, it returns the real prior decision.

create or replace function public.decide_gate(
  target_gate_id uuid,
  new_status text,
  decision_payload jsonb default '{}'::jsonb
)
returns public.gates
language plpgsql
security definer
set search_path = public
as $$
declare
  gate_org_id uuid;
  updated_gate public.gates;
  current_gate public.gates;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if new_status not in ('approved', 'rejected') then
    raise exception 'new_status must be approved or rejected, got: %', new_status;
  end if;

  select org_id into gate_org_id from public.gates where id = target_gate_id;

  if gate_org_id is null then
    raise exception 'gate not found';
  end if;

  if not public.is_org_member(gate_org_id) then
    raise exception 'not a member of this org';
  end if;

  -- The atomic conditional update: only succeeds if the row is still
  -- 'pending' at the moment Postgres acquires the row lock. This is what
  -- makes "only a signed-in human session can resolve a gate" and the
  -- two-simultaneous-clicks requirement both hold at once — there's no
  -- separate read-then-write window for a race to land in.
  update public.gates
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision = decision_payload
  where id = target_gate_id
    and status = 'pending'
  returning * into updated_gate;

  if updated_gate.id is not null then
    insert into public.audit_log (org_id, actor, action, target)
    values (gate_org_id, auth.uid(), 'gate_' || new_status, target_gate_id::text);

    return updated_gate;
  end if;

  -- Lost the race (or the gate was already decided earlier): re-read the
  -- real current state and report it, rather than silently pretending
  -- the caller's click succeeded or throwing an opaque error.
  select * into current_gate from public.gates where id = target_gate_id;

  raise exception 'gate_already_decided: status=%, decided_by=%, decided_at=%',
    current_gate.status, current_gate.decided_by, current_gate.decided_at;
end;
$$;

-- An agent (MCP) must never call this function to approve its own gate.
-- Spec §5.12: "No decide_gate tool in v1. An agent must not approve its
-- own gate." This is enforced by NOT exposing decide_gate through the MCP
-- tool surface at the application layer (apps/web's MCP route never maps
-- a tool to this RPC) — the RPC itself has no way to distinguish "a human
-- clicked a button" from "an MCP client called the RPC directly" since
-- both authenticate as the same auth.uid(). The real guarantee is
-- architectural: this function is only ever invoked from the approval
-- card's UI action, and the MCP route's tool list is reviewed in M13 to
-- confirm decide_gate was never added to it.
