-- M1: generic helper used before any table exists.
-- is_org_member()/is_org_admin() live in 00000000000002a_org_helpers.sql
-- instead — they query org_members, which doesn't exist until
-- 00000000000002_orgs.sql creates it, and a plain `language sql` function
-- is validated against the schema at CREATE time, not at call time.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
