-- M4: platform admin dashboard.
--
-- Agency lifecycle fields (plan label, internal notes, suspension),
-- suspension enforced everywhere membership is checked, and the
-- platform-admin-only reads and actions the dashboard needs. Every
-- action is audit-logged against the agency it touches.

alter table public.orgs add column plan text not null default 'trial'
  check (plan in ('trial', 'starter', 'pro', 'enterprise', 'custom'));
alter table public.orgs add column internal_notes text
  check (internal_notes is null or char_length(internal_notes) <= 10000);
alter table public.orgs add column suspended_at timestamptz;
alter table public.orgs add column suspended_reason text
  check (suspended_reason is null or char_length(suspended_reason) <= 500);

-- Platform admins are revoked, not removed, so there's a record of who had access.
alter table public.platform_admins add column revoked_at timestamptz;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and revoked_at is null
  );
$$;

-- ---------------------------------------------------------------
-- Suspension: a suspended agency's members lose access to everything
-- (every policy goes through these three helpers) and paid jobs stop.
-- ---------------------------------------------------------------

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
    join public.orgs o on o.id = m.org_id
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.seat_active = true
      and o.suspended_at is null
  );
$$;

create or replace function public.is_org_admin(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
      and m.seat_active = true
      and o.suspended_at is null
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
    join public.orgs o on o.id = m.org_id
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.seat_active = true
      and o.suspended_at is null
  );
$$;

create or replace function public.claim_paid_job(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org_row public.orgs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'claim_paid_job can only be called by the service role';
  end if;

  select * into org_row from public.orgs where id = target_org_id;

  if org_row.id is null then
    raise exception 'org not found';
  end if;

  if org_row.suspended_at is not null then
    raise exception 'org_suspended: this agency''s account is suspended';
  end if;

  if org_row.paused then
    raise exception 'org_paused: %', coalesce(org_row.pause_reason, 'spend guard has paused this org');
  end if;
end;
$$;

-- For the app's home screen: agencies the caller belongs to that are suspended.
create or replace function public.my_suspended_orgs()
returns table (org_id uuid, org_name text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.suspended_reason
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid() and o.suspended_at is not null;
$$;

-- ---------------------------------------------------------------
-- Reads (platform admin only).
-- ---------------------------------------------------------------

create or replace function public.platform_org_overview()
returns table (
  org_id uuid,
  org_name text,
  plan text,
  created_at timestamptz,
  paused boolean,
  pause_reason text,
  suspended_at timestamptz,
  suspended_reason text,
  seat_cap integer,
  warn_usd numeric,
  stop_usd numeric,
  internal_notes text,
  owner_email text,
  owner_accepted boolean,
  members_active integer,
  members_total integer,
  pending_invites integer,
  brands_count integer,
  ads_total integer,
  ads_30d integer,
  spend_24h numeric,
  spend_7d numeric,
  spend_30d numeric,
  keys_count integer,
  last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view all agencies';
  end if;

  return query
  select
    o.id,
    o.name,
    o.plan,
    o.created_at,
    o.paused,
    o.pause_reason,
    o.suspended_at,
    o.suspended_reason,
    o.seat_cap,
    o.warn_usd,
    o.stop_usd,
    o.internal_notes,
    coalesce(
      (select u.email::text from public.org_members m join auth.users u on u.id = m.user_id
       where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
      (select pi.email from public.pending_invites pi
       where pi.org_id = o.id and pi.role = 'owner' and pi.accepted_at is null order by pi.created_at limit 1)
    ),
    exists (select 1 from public.org_members m where m.org_id = o.id and m.role = 'owner'),
    (select count(*)::int from public.org_members m where m.org_id = o.id and m.seat_active),
    (select count(*)::int from public.org_members m where m.org_id = o.id),
    (select count(*)::int from public.pending_invites pi where pi.org_id = o.id and pi.accepted_at is null),
    (select count(*)::int from public.brands b where b.org_id = o.id and b.active),
    (select count(*)::int from public.ads a where a.org_id = o.id),
    (select count(*)::int from public.ads a where a.org_id = o.id and a.created_at > now() - interval '30 days'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '24 hours'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '7 days'),
    (select coalesce(sum(s.usd_est), 0) from public.spend_events s where s.org_id = o.id and s.created_at > now() - interval '30 days'),
    (select count(*)::int from public.org_secrets k where k.org_id = o.id),
    greatest(
      (select max(a.created_at) from public.audit_log a where a.org_id = o.id),
      (select max(s.created_at) from public.spend_events s where s.org_id = o.id),
      (select max(ad.updated_at) from public.ads ad where ad.org_id = o.id)
    )
  from public.orgs o
  order by o.created_at desc;
end;
$$;

-- Spend per day for the last `days` days (zero-filled), all agencies or one.
create or replace function public.platform_daily_spend(days integer default 30, target_org_id uuid default null)
returns table (day date, usd numeric, events integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view spend';
  end if;

  return query
  select d::date,
         coalesce(sum(s.usd_est), 0),
         count(s.id)::int
  from generate_series(current_date - (greatest(days, 1) - 1), current_date, interval '1 day') as d
  left join public.spend_events s
    on s.created_at >= d and s.created_at < d + interval '1 day'
   and (target_org_id is null or s.org_id = target_org_id)
  group by d
  order by d;
end;
$$;

create or replace function public.platform_spend_breakdown(target_org_id uuid, days integer default 30)
returns table (provider text, kind text, usd numeric, events integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view spend';
  end if;

  return query
  select coalesce(s.provider, 'unknown'), coalesce(s.kind, 'other'), sum(s.usd_est), count(*)::int
  from public.spend_events s
  where s.org_id = target_org_id and s.created_at > now() - make_interval(days => greatest(days, 1))
  group by 1, 2
  order by 3 desc;
end;
$$;

create or replace function public.platform_audit_log(target_org_id uuid default null, row_limit integer default 100)
returns table (id uuid, org_id uuid, org_name text, actor_email text, action text, target text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view activity';
  end if;

  return query
  select a.id, a.org_id, o.name, u.email::text, a.action, a.target, a.created_at
  from public.audit_log a
  join public.orgs o on o.id = a.org_id
  left join auth.users u on u.id = a.actor
  where target_org_id is null or a.org_id = target_org_id
  order by a.created_at desc
  limit least(greatest(row_limit, 1), 500);
end;
$$;

create or replace function public.platform_org_brands(target_org_id uuid)
returns table (brand_id uuid, brand_name text, active boolean, products integer, ads integer, assignees integer, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can view brands';
  end if;

  return query
  select b.id, b.name, b.active,
    (select count(*)::int from public.products p where p.brand_id = b.id and p.active),
    (select count(*)::int from public.ads a where a.brand_id = b.id),
    (select count(*)::int from public.brand_assignments ba where ba.brand_id = b.id and ba.active),
    b.created_at
  from public.brands b
  where b.org_id = target_org_id
  order by b.active desc, b.name;
end;
$$;

create or replace function public.list_platform_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can list platform admins';
  end if;

  return query
  select p.user_id, u.email::text, p.created_at
  from public.platform_admins p
  join auth.users u on u.id = p.user_id
  where p.revoked_at is null
  order by p.created_at;
end;
$$;

-- ---------------------------------------------------------------
-- Actions (platform admin only, audit-logged).
-- ---------------------------------------------------------------

create or replace function public.platform_set_org_suspended(target_org_id uuid, suspend boolean, reason text default null)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can suspend an agency';
  end if;

  update public.orgs
  set suspended_at = case when suspend then coalesce(suspended_at, now()) else null end,
      suspended_reason = case when suspend then nullif(trim(coalesce(reason, '')), '') else null end
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'agency not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), case when suspend then 'agency_suspended' else 'agency_reactivated' end,
          nullif(trim(coalesce(reason, '')), ''));

  return updated_org;
end;
$$;

create or replace function public.platform_update_org(target_org_id uuid, new_name text, new_plan text, new_notes text)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can edit an agency';
  end if;

  if new_name is null or char_length(trim(new_name)) = 0 then
    raise exception 'agency name is required';
  end if;

  update public.orgs
  set name = trim(new_name),
      plan = new_plan,
      internal_notes = nullif(trim(coalesce(new_notes, '')), '')
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'agency not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'agency_updated', trim(new_name) || ' / ' || new_plan);

  return updated_org;
end;
$$;

create or replace function public.platform_set_spend_limits(target_org_id uuid, new_warn_usd numeric, new_stop_usd numeric)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change spend limits';
  end if;

  if (new_warn_usd is not null and new_warn_usd < 0) or (new_stop_usd is not null and new_stop_usd < 0) then
    raise exception 'spend limits can''t be negative';
  end if;

  if new_warn_usd is not null and new_stop_usd is not null and new_warn_usd > new_stop_usd then
    raise exception 'the warning level must be at or below the stop level';
  end if;

  update public.orgs
  set warn_usd = new_warn_usd, stop_usd = new_stop_usd
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'agency not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'spend_limits_changed',
          'warn ' || coalesce(new_warn_usd::text, 'none') || ' / stop ' || coalesce(new_stop_usd::text, 'none'));

  return updated_org;
end;
$$;

create or replace function public.platform_resume_org(target_org_id uuid)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can resume an agency';
  end if;

  update public.orgs set paused = false, pause_reason = null
  where id = target_org_id
  returning * into updated_org;

  if updated_org.id is null then
    raise exception 'agency not found';
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'spend_guard_resumed', 'by platform admin');

  return updated_org;
end;
$$;

-- Invite someone into an existing agency, any role including owner.
-- Platform admins aren't held to the seat cap (they set it), but an
-- existing unaccepted invite for the same email is reused.
create or replace function public.platform_invite_member(target_org_id uuid, invitee_email text, invitee_role text)
returns public.pending_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.pending_invites;
  new_invite public.pending_invites;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can invite into an agency';
  end if;

  if invitee_role not in ('owner', 'admin', 'editor') then
    raise exception 'invalid role: %', invitee_role;
  end if;

  if invitee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email: %', invitee_email;
  end if;

  if not exists (select 1 from public.orgs where id = target_org_id) then
    raise exception 'agency not found';
  end if;

  if exists (
    select 1 from public.org_members m join auth.users u on u.id = m.user_id
    where m.org_id = target_org_id and lower(u.email) = lower(invitee_email)
  ) then
    raise exception 'that person is already a member of this agency';
  end if;

  select * into existing from public.pending_invites
  where org_id = target_org_id and email = lower(invitee_email) and accepted_at is null;

  if existing.id is not null then
    update public.pending_invites set role = invitee_role where id = existing.id returning * into new_invite;
  else
    insert into public.pending_invites (org_id, email, role, invited_by)
    values (target_org_id, lower(invitee_email), invitee_role, auth.uid())
    returning * into new_invite;
  end if;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'member_invited', lower(invitee_email) || ' as ' || invitee_role);

  return new_invite;
end;
$$;

create or replace function public.add_platform_admin(admin_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can add platform admins';
  end if;

  select id into target_user from auth.users where lower(email) = lower(trim(admin_email));
  if target_user is null then
    raise exception 'no account uses that email yet: ask them to sign in once first';
  end if;

  insert into public.platform_admins (user_id) values (target_user)
  on conflict (user_id) do update set revoked_at = null;
end;
$$;

create or replace function public.revoke_platform_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can remove platform admins';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'you can''t remove yourself';
  end if;

  update public.platform_admins set revoked_at = now()
  where user_id = target_user_id and revoked_at is null;
end;
$$;
