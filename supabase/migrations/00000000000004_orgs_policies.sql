-- M1: RLS policies for orgs and org_members, now that is_org_member()
-- exists (00000000000002a_org_helpers.sql).

-- Members can read their own org's row. Nobody can insert/update/delete
-- directly from the browser role — org creation and spend-guard pause
-- state changes go through security-definer RPCs (create_org, resume_org).
create policy orgs_select_own on public.orgs
  for select
  using (public.is_org_member(id));

-- Members can see the membership roster of orgs they belong to (needed to
-- render the team list). Only admins/owners can change roles or seats —
-- enforced via RPC, not direct table writes from the browser role.
create policy org_members_select_same_org on public.org_members
  for select
  using (public.is_org_member(org_id));
