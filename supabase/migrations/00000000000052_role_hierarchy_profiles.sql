-- M3: role hierarchy, profiles.
--
-- Until now owner and admin were identical: either could invite new
-- owners, promote themselves, demote or deactivate the owner. The
-- hierarchy this migration enforces:
--   * owner role is granted only by a platform admin (set_member_role,
--     unchanged); inside an org nobody can hand out "owner".
--   * team management (invite, role change, seat toggle, revoke) is
--     owner-only. Admins can still READ the roster (list_org_members /
--     list_org_pending_invites stay is_org_admin).
--   * nobody edits their own row, and an owner's row can't be edited
--     from inside the org at all.
--   * org-wide provider keys, the audit log and resuming a paused org
--     are owner-only. Brand-level keys stay owner+admin.
--
-- Also fixes is_org_member(): it ignored seat_active, so a deactivated
-- member kept full content access through every is_org_member policy.

create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.seat_active = true
  );
$$;

create or replace function public.is_org_owner(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.seat_active = true
  );
$$;

-- ---------------------------------------------------------------
-- Team management: owner-only, admin/editor roles only, never self,
-- never an owner row.
-- ---------------------------------------------------------------

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
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner of this org can invite a member';
  end if;

  if invitee_role not in ('admin', 'editor') then
    raise exception 'invalid role: % (owners are assigned by the platform admin)', invitee_role;
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

-- Shared guard for every owner action on another member's row.
create or replace function public.assert_owner_can_manage_member(
  target_org_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner of this org can manage members';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'you can''t change your own membership';
  end if;

  select role into target_role
  from public.org_members
  where org_id = target_org_id and user_id = target_user_id;

  if target_role is null then
    raise exception 'member not found';
  end if;

  if target_role = 'owner' then
    raise exception 'owners can only be changed by the platform admin';
  end if;
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
begin
  perform public.assert_owner_can_manage_member(target_org_id, target_user_id);

  if new_role not in ('admin', 'editor') then
    raise exception 'invalid role: % (owners are assigned by the platform admin)', new_role;
  end if;

  update public.org_members
  set role = new_role
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_role_changed', target_user_id::text || ' -> ' || new_role);

  return updated_member;
end;
$$;

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
  perform public.assert_owner_can_manage_member(target_org_id, target_user_id);

  update public.org_members
  set seat_active = active
  where org_id = target_org_id and user_id = target_user_id
  returning * into updated_member;

  insert into public.audit_log (org_id, actor, action, target)
  values (
    target_org_id, auth.uid(),
    case when active then 'member_seat_activated' else 'member_seat_deactivated' end,
    target_user_id::text
  );

  return updated_member;
end;
$$;

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

  if not public.is_org_owner(invite_org_id) then
    raise exception 'only the owner of this org can revoke an invite';
  end if;

  delete from public.pending_invites where id = target_invite_id;

  insert into public.audit_log (org_id, actor, action, target)
  values (invite_org_id, auth.uid(), 'invite_revoked', invite_email);
end;
$$;

-- ---------------------------------------------------------------
-- Owner-only org configuration.
-- ---------------------------------------------------------------

create or replace function public.save_org_secret(target_org_id uuid, target_provider text, secret_value text)
returns table(id uuid, provider text, last4 text, verified_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_vault_id uuid;
  new_vault_id uuid;
  secret_name text;
  row_result public.org_secrets;
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner can manage org-wide provider keys';
  end if;

  if length(secret_value) < 4 then
    raise exception 'secret value too short';
  end if;

  secret_name := 'org_secret:' || target_org_id::text || ':' || target_provider;

  select s.vault_secret_id into existing_vault_id
  from public.org_secrets s
  where s.org_id = target_org_id and s.provider = target_provider;

  if existing_vault_id is not null then
    perform vault.update_secret(existing_vault_id, secret_value);
    new_vault_id := existing_vault_id;
  else
    new_vault_id := vault.create_secret(secret_value, secret_name);
  end if;

  insert into public.org_secrets as os (org_id, provider, vault_secret_id, last4)
  values (target_org_id, target_provider, new_vault_id, right(secret_value, 4))
  on conflict on constraint org_secrets_org_id_provider_key do update
    set vault_secret_id = excluded.vault_secret_id,
        last4 = excluded.last4,
        verified_at = null
  returning os.* into row_result;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'org_secret_saved', target_provider);

  return query select row_result.id, row_result.provider, row_result.last4, row_result.verified_at;
end;
$$;

create or replace function public.mark_org_secret_verified(target_org_id uuid, target_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner can verify org-wide provider keys';
  end if;

  update public.org_secrets
  set verified_at = now()
  where org_id = target_org_id and provider = target_provider;
end;
$$;

create or replace function public.list_org_secrets(target_org_id uuid)
returns table(provider text, last4 text, verified_at timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner can view org-wide provider key status';
  end if;

  return query
    select s.provider, s.last4, s.verified_at, s.created_at
    from public.org_secrets s
    where s.org_id = target_org_id
    order by s.provider;
end;
$$;

create or replace function public.list_org_audit_log(target_org_id uuid, row_limit integer default 50)
returns table(id uuid, actor_email text, action text, target text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner of this org can view its audit log';
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

-- Direct reads of audit_log follow the same owner-only rule.
alter policy audit_log_select_admin on public.audit_log
  using (public.is_org_owner(org_id));

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
  if not public.is_org_owner(target_org_id) then
    raise exception 'only the owner of this org can resume it';
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

-- ---------------------------------------------------------------
-- Profiles: name, phone, photo. Email stays on auth.users and is
-- changed only through the owner / platform-admin server actions.
-- ---------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  avatar_path text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Visible to yourself, to anyone who shares an org with you (rosters,
-- task assignees), and to platform admins.
create policy profiles_select_visible on public.profiles
  for select using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1
      from public.org_members mine
      join public.org_members theirs on theirs.org_id = mine.org_id
      where mine.user_id = auth.uid()
        and mine.seat_active
        and theirs.user_id = profiles.user_id
    )
  );

create policy profiles_insert_self on public.profiles
  for insert with check (user_id = auth.uid());

create policy profiles_update_self on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Avatars: public-read bucket (a profile photo isn't sensitive and a
-- public URL avoids signing on every roster render). Each user may only
-- write inside their own <user_id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Roster read with name/photo, ordered owner > admin > editor. A new
-- name rather than redefining list_org_members, whose return columns
-- can't change in place.
create or replace function public.list_org_team(target_org_id uuid)
returns table (
  member_user_id uuid,
  member_email text,
  member_role text,
  member_seat_active boolean,
  member_joined_at timestamptz,
  member_full_name text,
  member_avatar_path text
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
    select m.user_id, u.email::text, m.role, m.seat_active, m.created_at, p.full_name, p.avatar_path
    from public.org_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = target_org_id
    order by
      case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
      m.created_at;
end;
$$;

-- Records an email change made through the owner / platform-admin
-- server actions (the change itself goes through the Auth admin API
-- with the service role, which can't run inside SQL).
create or replace function public.log_member_email_changed(
  target_org_id uuid,
  target_user_id uuid,
  new_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_platform_admin() or public.is_org_owner(target_org_id)) then
    raise exception 'not allowed';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_email_changed', target_user_id::text || ' -> ' || lower(new_email));
end;
$$;
