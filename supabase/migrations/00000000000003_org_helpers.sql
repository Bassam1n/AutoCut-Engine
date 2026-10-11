-- M1: org-scoped RLS helper functions. Depend on org_members existing
-- (00000000000002_orgs.sql), used by every table-level RLS policy from
-- here on, including orgs/org_members' own policies in
-- 00000000000002b_orgs_policies.sql.

-- is_org_member(org_id): true iff the currently authenticated user
-- (auth.uid()) is an active member of that org. SECURITY DEFINER so it
-- can read org_members regardless of the caller's own RLS visibility into
-- that table, STABLE so Postgres can fold repeated calls within one query.
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
  );
$$;

-- is_org_admin(org_id): true iff the user is an active owner or admin of
-- that org. Used for admin-only writes (spend guard resume, role changes,
-- provider key management).
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
    where m.org_id = check_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
      and m.seat_active = true
  );
$$;
