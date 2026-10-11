-- M2: per-org team management for the agency's OWN admins/owners —
-- the piece 00000000000017_platform_admins.sql's comment on
-- pending_invites flagged as "built alongside the team screen."
--
-- Scoped mirror of the platform-admin membership RPCs
-- (00000000000019_platform_admin_membership.sql), but gated by
-- is_org_admin(org_id) instead of is_platform_admin(), and restricted
-- to the caller's own org — an org admin must never see or touch
-- another agency's membership.
--
-- seat_cap: added here rather than in the original orgs table because
-- the real requirement only surfaced now — org admins get to invite
-- their own team, but a per-org ceiling on how many seats they can
-- fill is set by the platform operator, not the agency itself (so an
-- agency can't silently add 200 editors on a plan sized for 5). null
-- means "no cap set yet" and blocks every invite until a platform
-- admin sets one, rather than defaulting to unlimited.
alter table public.orgs
  add column seat_cap integer;

alter table public.orgs
  add constraint orgs_seat_cap_positive check (seat_cap is null or seat_cap > 0);

-- set_org_seat_cap: platform-admin-only. Deliberately not bundled into
-- register_agency() — the operator may want to set/change a cap for an
-- org at any point, not only at registration time.
create or replace function public.set_org_seat_cap(
  target_org_id uuid,
  new_seat_cap integer
)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can set an org''s seat cap';
  end if;

  if new_seat_cap is not null and new_seat_cap <= 0 then
    raise exception 'seat cap must be a positive integer';
  end if;

  update public.orgs
  set seat_cap = new_seat_cap
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'org not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'seat_cap_changed', coalesce(new_seat_cap::text, 'null'));

  return updated_org;
end;
$$;

-- org_seat_usage(org_id): active members + unaccepted invites, i.e.
-- every seat that's either filled or claimed. Both an active member
-- and a pending invite consume a seat — otherwise an admin could
-- invite past the cap and only get blocked when each invite is
-- accepted, discovering the problem one at a time instead of upfront.
create or replace function public.org_seat_usage(check_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.org_members where org_id = check_org_id and seat_active)
    +
    (select count(*) from public.pending_invites where org_id = check_org_id and accepted_at is null);
$$;

-- invite_member: the org-admin-facing counterpart to register_agency().
-- Creates a pending_invites row for a new team member of the CALLER's
-- own org — never lets an org admin target another org's id. Refuses
-- once org_seat_usage() would meet or exceed seat_cap, and refuses
-- outright when seat_cap is null (no cap configured yet by the
-- platform admin, so no capacity is known to be available).
create or replace function public.invite_member(
  target_org_id uuid,
  invitee_email text,
  invitee_role text
)
returns public.pending_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  org_row public.orgs;
  new_invite public.pending_invites;
  current_usage integer;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can invite a member';
  end if;

  if invitee_role not in ('owner', 'admin', 'editor') then
    raise exception 'invalid role: %', invitee_role;
  end if;

  if invitee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email: %', invitee_email;
  end if;

  select * into org_row from public.orgs where id = target_org_id;

  if org_row.seat_cap is null then
    raise exception 'seat_cap_not_configured';
  end if;

  select public.org_seat_usage(target_org_id) into current_usage;

  if current_usage >= org_row.seat_cap then
    raise exception 'seat_cap_reached';
  end if;

  insert into public.pending_invites (org_id, email, role, invited_by)
  values (target_org_id, lower(invitee_email), invitee_role, auth.uid())
  returning * into new_invite;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_invited', lower(invitee_email));

  return new_invite;
end;
$$;

-- list_org_members / list_org_pending_invites: the org-scoped reads
-- backing the team screen. org_members/orgs are already selectable
-- directly under RLS (is_org_member), but auth.users.email is not —
-- so these stay as RPCs purely to do the same auth.users join
-- list_all_orgs_with_members() does, scoped to one org and gated by
-- is_org_admin() rather than is_platform_admin().
create or replace function public.list_org_members(target_org_id uuid)
returns table (
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
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can list its members';
  end if;

  return query
    select m.user_id, u.email::text, m.role, m.seat_active, m.created_at
    from public.org_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = target_org_id
    order by m.created_at;
end;
$$;

create or replace function public.list_org_pending_invites(target_org_id uuid)
returns table (
  invite_id uuid,
  email text,
  role text,
  invited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can list its pending invites';
  end if;

  return query
    select pi.id, pi.email, pi.role, pi.created_at
    from public.pending_invites pi
    where pi.org_id = target_org_id
      and pi.accepted_at is null
    order by pi.created_at;
end;
$$;

-- revoke_org_invite: same semantics as the platform-admin
-- revoke_pending_invite(), but scoped — an org admin may only revoke
-- an invite that belongs to their own org.
create or replace function public.revoke_org_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_org_id uuid;
  invite_email text;
begin
  select org_id, email into invite_org_id, invite_email
  from public.pending_invites
  where id = target_invite_id and accepted_at is null;

  if invite_org_id is null then
    raise exception 'pending invite not found (already accepted or does not exist)';
  end if;

  if not public.is_org_admin(invite_org_id) then
    raise exception 'only an owner or admin of this org can revoke this invite';
  end if;

  delete from public.pending_invites where id = target_invite_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (invite_org_id, auth.uid(), 'invite_revoked', invite_email);
end;
$$;

-- set_org_member_seat_active / set_org_member_role: org-admin-scoped
-- counterparts to the platform-admin set_member_seat_active()/
-- set_member_role() (00000000000019_platform_admin_membership.sql).
-- Same only-owner-demotion guard. Deactivating a seat does NOT free a
-- slot against seat_cap by itself the moment usage is recomputed —
-- org_seat_usage() only counts seat_active members, so a deactivated
-- member stops counting against the cap immediately, same as a
-- platform admin's seat toggle would.
create or replace function public.set_org_member_seat_active(
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
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can change member seat status';
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

create or replace function public.set_org_member_role(
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
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin of this org can change member roles';
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
