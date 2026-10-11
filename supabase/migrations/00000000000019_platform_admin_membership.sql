-- M2: platform-admin read/write access to every org's membership, for
-- the owners-and-team-members management table on /platform-admin.
--
-- Deliberately NOT done by widening org_members'/orgs' own RLS policies
-- to include is_platform_admin() — that would make platform-admin
-- status a silent, always-on bypass baked into the general-purpose
-- table policies, which is harder to audit and easy to forget about
-- later. Instead: dedicated, explicitly-named SECURITY DEFINER RPCs,
-- same pattern as register_agency()/accept_invite(). Each one's name
-- says exactly what elevated access it grants and why.

-- list_all_orgs_with_members: one row per (org, member) pair, plus a
-- separate query for pending invites (kept as two functions rather than
-- one giant join so the UI can render "accepted members" and "pending
-- invites" as clearly distinct sections, matching how pending_invites
-- itself models them as different states, not a unified list with a
-- status column bolted on).
create or replace function public.list_all_orgs_with_members()
returns table (
  org_id uuid,
  org_name text,
  org_paused boolean,
  member_user_id uuid,
  member_email text,
  member_role text,
  member_seat_active boolean,
  member_joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can list all org membership';
  end if;

  return query
    select
      o.id,
      o.name,
      o.paused,
      m.user_id,
      u.email::text,
      m.role,
      m.seat_active,
      m.created_at
    from public.orgs o
    join public.org_members m on m.org_id = o.id
    join auth.users u on u.id = m.user_id
    order by o.name, m.created_at;
end;
$$;

create or replace function public.list_all_pending_invites()
returns table (
  invite_id uuid,
  org_id uuid,
  org_name text,
  email text,
  role text,
  invited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can list all pending invites';
  end if;

  return query
    select
      pi.id,
      pi.org_id,
      o.name,
      pi.email,
      pi.role,
      pi.created_at
    from public.pending_invites pi
    join public.orgs o on o.id = pi.org_id
    where pi.accepted_at is null
    order by o.name, pi.created_at;
end;
$$;

-- set_member_seat_active: toggle a member's access on/off without
-- removing their row (preserves their role/history — matches spec §5.1
-- "Seats are toggled per member" exactly). Deactivating does NOT revoke
-- their current Supabase session immediately (that needs a separate
-- admin.signOut() call from application code, since SQL can't reach the
-- Auth service) — RLS blocking every org-scoped table the instant
-- seat_active flips is the real enforcement; signOut is a courtesy, not
-- the security boundary. Logged either way.
create or replace function public.set_member_seat_active(
  target_org_id uuid,
  target_user_id uuid,
  active boolean
)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.org_members;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change member seat status';
  end if;

  update public.org_members
  set seat_active = active
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  if updated_member.user_id is null then
    raise exception 'member not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (
    target_org_id, auth.uid(),
    case when active then 'member_seat_activated' else 'member_seat_deactivated' end,
    target_user_id::text
  );

  return updated_member;
end;
$$;

-- set_member_role: change a member's role. Guards against demoting the
-- org's only owner (an org with zero owners has nobody who can manage
-- it or invite further admins — a real dead end, not just an
-- inconvenience), same reasoning as why owners can't be deleted
-- outright in most multi-tenant systems.
create or replace function public.set_member_role(
  target_org_id uuid,
  target_user_id uuid,
  new_role text
)
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.org_members;
  owner_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change member roles';
  end if;

  if new_role not in ('owner', 'admin', 'editor') then
    raise exception 'invalid role: %', new_role;
  end if;

  if new_role != 'owner' then
    select count(*) into owner_count
    from public.org_members
    where org_id = target_org_id and role = 'owner' and user_id != target_user_id;

    if owner_count = 0 then
      raise exception 'cannot demote the only owner — promote another member to owner first';
    end if;
  end if;

  update public.org_members
  set role = new_role
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  if updated_member.user_id is null then
    raise exception 'member not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_role_changed', target_user_id::text || ' -> ' || new_role);

  return updated_member;
end;
$$;

-- revoke_pending_invite: cancels an invite that hasn't been accepted
-- yet. If the invitee somehow already has the link and tries to use it
-- after this, accept_invite() finds no matching unaccepted row and
-- correctly fails — deleting the pending_invites row IS the revocation,
-- there's no separate "revoked" state to track.
create or replace function public.revoke_pending_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_org_id uuid;
  invite_email text;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can revoke an invite';
  end if;

  select org_id, email into invite_org_id, invite_email
  from public.pending_invites
  where id = target_invite_id and accepted_at is null;

  if invite_org_id is null then
    raise exception 'pending invite not found (already accepted or does not exist)';
  end if;

  delete from public.pending_invites where id = target_invite_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (invite_org_id, auth.uid(), 'invite_revoked', invite_email);
end;
$$;
