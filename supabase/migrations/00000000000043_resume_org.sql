-- M8 (spend admin, first slice): resume_org. Spec §5.10: "Only an
-- owner or admin can resume, and resuming is logged." Until now
-- claim_paid_job() (00000000000031_spend_guard.sql) could PAUSE an
-- org but nothing could ever flip `orgs.paused` back — a real stop-
-- threshold trip left the org stuck permanently. This is the missing
-- resume path, gated the same way every other org-admin RPC is gated
-- (00000000000021_org_admin_team.sql's is_org_admin(target_org_id)
-- check, raise exception on failure).
--
-- pause_reason is deliberately left in place rather than cleared —
-- clearing it on resume would destroy the only record of *why* the
-- org was paused, right as the audit trail matters most (someone
-- just resumed spend after a stop-threshold trip; knowing what
-- tripped it stays useful after the fact). The spend admin screen
-- distinguishes "currently paused" (orgs.paused) from "last pause
-- reason" (orgs.pause_reason) rather than relying on pause_reason
-- being null to mean "never paused" or non-null to mean "paused now."
create or replace function public.resume_org(target_org_id uuid)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
  current_spend numeric;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can resume it';
  end if;

  update public.orgs
  set paused = false
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'org not found';
  end if;

  select public.org_spend_24h(target_org_id) into current_spend;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'spend_guard_resumed', current_spend::text);

  return updated_org;
end;
$$;

-- list_org_audit_log: the org-scoped read backing the spend admin
-- screen's audit trail. audit_log's own RLS (audit_log_select_admin,
-- 00000000000012_spend_tokens_audit.sql) already restricts select to
-- is_org_admin(org_id), so a direct select from the browser would
-- already be correctly scoped — this stays an RPC only to add the
-- auth.users join for a human-readable actor (same reasoning as
-- list_org_members() above: auth.users isn't selectable directly
-- under RLS). Shows every action type recorded for the org, not just
-- spend_guard_*, since an "audit log" that silently drops rows (e.g.
-- member_role_changed, seat_cap_changed, invite_revoked — all written
-- by 00000000000021_org_admin_team.sql) would be misleading about
-- what it claims to show.
create or replace function public.list_org_audit_log(
  target_org_id uuid,
  row_limit integer default 50
)
returns table (
  id uuid,
  actor_email text,
  action text,
  target text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can view its audit log';
  end if;

  return query
    select a.id, u.email::text, a.action, a.target, a.created_at
    from public.audit_log a
    left join auth.users u on u.id = a.actor
    where a.org_id = target_org_id
    order by a.created_at desc
    limit row_limit;
end;
$$;

-- No blanket revoke from anon/authenticated here — matching the
-- established pattern for admin-gated RPCs in this codebase
-- (invite_member, set_org_member_role, etc. in
-- 00000000000021_org_admin_team.sql all grant implicitly to
-- authenticated via default PostgreSQL function privileges and rely
-- solely on the internal is_org_admin() check as the real gate, unlike
-- the service-role-only RPCs in 00000000000031_spend_guard.sql which
-- DO revoke from anon/authenticated because they must never be
-- callable by the browser at all, admin or not). resume_org is meant
-- to be called by an org admin directly from the browser, so it
-- follows the org_admin_team.sql convention, not the spend_guard.sql
-- one.
