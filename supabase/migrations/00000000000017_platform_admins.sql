-- M2: platform_admins — identifies the platform operator(s), distinct
-- from org owners/admins. Not in the original spec §4 table list; added
-- because the actual onboarding model turned out to need it: there is no
-- self-serve signup (a stranger typing an email into /login should never
-- be able to create an org), so a new agency only comes into existence
-- when the platform operator registers it from a platform-admin area.
--
-- Deliberately a table, not a hardcoded user id in code: auditable
-- (who has platform access, when it was granted), revocable without a
-- redeploy, and consistent with how every other permission boundary in
-- this schema is a database row + RLS, not an app-code check.

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- is_platform_admin(): true iff the caller is a registered platform
-- operator. SECURITY DEFINER + STABLE, same pattern as is_org_member()/
-- is_org_admin() in 00000000000003_org_helpers.sql.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

-- A platform admin can see the list of other platform admins (so the
-- platform-admin UI can render it), but granting/revoking goes through
-- an RPC — never a direct insert/update/delete from the browser role,
-- same reasoning as every other sensitive table in this schema.
create policy platform_admins_select on public.platform_admins
  for select using (public.is_platform_admin());

-- register_agency: the ONLY way a new org comes into existence outside
-- of... actually, this replaces create_org() as the real-world entry
-- point. create_org() (00000000000013_rpc_orgs_secrets.sql) still exists
-- and still works the same way for any authenticated user — but nothing
-- in the UI exposes a path to call it anymore now that /login has no
-- signup form. register_agency() is strictly platform-admin-gated and is
-- what the platform-admin UI actually calls: creates the org, invites
-- the given email as owner via Supabase's admin API equivalent (done in
-- application code, since generateLink requires the service role key,
-- which SQL functions don't have direct access to) — this RPC handles
-- the DB side (org + a placeholder org_members row keyed by email until
-- the invite is accepted and a real auth.users row exists).
--
-- Two-step because of a real constraint: org_members.user_id references
-- auth.users(id), but at registration time the owner's auth.users row
-- doesn't exist yet (they haven't signed in). pending_invites holds the
-- email + intended role until accept_invite() (next migration) converts
-- it into a real org_members row once they actually sign in for the
-- first time.
create table public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'editor')),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

alter table public.pending_invites enable row level security;

-- Org admins can see their own org's pending invites (so the per-org
-- team screen can show "invite sent, not yet accepted"). Platform admins
-- can see all of them (needed for the registration screen's own
-- bookkeeping). Neither can insert/update directly — register_agency()
-- and invite_member() (per-org version, built alongside the team screen)
-- are the only write paths.
create policy pending_invites_select_org_admin on public.pending_invites
  for select using (public.is_org_admin(org_id));
create policy pending_invites_select_platform_admin on public.pending_invites
  for select using (public.is_platform_admin());

create or replace function public.register_agency(
  org_name text,
  owner_email text
)
returns table (org_id uuid, invite_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.orgs;
  new_invite public.pending_invites;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can register a new agency';
  end if;

  if owner_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email: %', owner_email;
  end if;

  insert into public.orgs (name)
  values (org_name)
  returning * into new_org;

  insert into public.pending_invites (org_id, email, role, invited_by)
  values (new_org.id, lower(owner_email), 'owner', auth.uid())
  returning * into new_invite;

  insert into public.audit_log (org_id, actor, action, target)
  values (new_org.id, auth.uid(), 'agency_registered', owner_email);

  return query select new_org.id, new_invite.id;
end;
$$;

-- accept_invite: called right after a user's FIRST sign-in (from the
-- auth callback route, in application code, using their now-real
-- auth.uid() and auth.email()). Converts a matching pending_invites row
-- into a real org_members row. If there's no matching pending invite for
-- their email, this is a no-op — they're signed in to Supabase Auth
-- (harmless on its own) but a member of zero orgs, so RLS blocks them
-- from seeing anything, which is the correct outcome for an uninvited
-- email that somehow got a session (should not happen if the UI never
-- offers a self-serve path, but this is the backstop if it ever does).
create or replace function public.accept_invite()
returns public.org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
  matched_invite public.pending_invites;
  new_member public.org_members;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select email into caller_email from auth.users where id = auth.uid();

  select * into matched_invite
  from public.pending_invites
  where email = lower(caller_email)
    and accepted_at is null
  order by created_at asc
  limit 1;

  if matched_invite.id is null then
    raise exception 'no_pending_invite_for_email';
  end if;

  insert into public.org_members (org_id, user_id, role, seat_active)
  values (matched_invite.org_id, auth.uid(), matched_invite.role, true)
  on conflict (org_id, user_id) do nothing
  returning * into new_member;

  update public.pending_invites
  set accepted_at = now()
  where id = matched_invite.id;

  insert into public.audit_log (org_id, actor, action, target)
  values (matched_invite.org_id, auth.uid(), 'invite_accepted', matched_invite.email);

  return new_member;
end;
$$;
