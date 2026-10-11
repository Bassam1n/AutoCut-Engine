-- M2: fix list_all_orgs_with_members() — "structure of query does not
-- match function result type" on first real test. auth.users.email is
-- character varying, not text; `returns table` requires an exact type
-- match, not just a compatible one. Caught by actually running the
-- function against the live database, not assumed from reading the SQL.
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
