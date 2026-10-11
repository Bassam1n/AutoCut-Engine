-- M2: surface orgs.seat_cap (00000000000021_org_admin_team.sql) on the
-- platform-admin membership listing, so the owners/team table can show
-- and edit each org's seat limit in the same place it manages roles
-- and access. Seat usage itself is NOT added here — the platform
-- table already fetches every member and every pending invite per org,
-- so usage is derivable in the UI from rows it already has, without a
-- second round trip per org.
--
-- Also switched orgs/org_members from an inner join to a left join
-- while touching this function: a freshly registered agency whose
-- owner hasn't accepted their invite yet has zero org_members rows,
-- so the inner join made it invisible here — meaning a platform admin
-- had no way to set its seat_cap before the first sign-in. The left
-- join surfaces the org with null member_* fields instead.
--
-- Postgres refuses `create or replace` when the OUT-parameter row
-- shape changes (adding org_seat_cap in the middle of the column
-- list), so the old signature must be dropped first.
drop function if exists public.list_all_orgs_with_members();

create function public.list_all_orgs_with_members()
returns table (
  org_id uuid,
  org_name text,
  org_paused boolean,
  org_seat_cap integer,
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
      o.seat_cap,
      m.user_id,
      u.email::text,
      m.role,
      m.seat_active,
      m.created_at
    from public.orgs o
    left join public.org_members m on m.org_id = o.id
    left join auth.users u on u.id = m.user_id
    order by o.name, m.created_at;
end;
$$;
