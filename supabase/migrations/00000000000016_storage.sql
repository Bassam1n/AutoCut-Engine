-- M1: storage buckets and policies. Spec §4: "Storage: private buckets
-- refs, renders, library. Paths {org_id}/{ad_id}/... Policies allow
-- access only when the first path segment is an org the user belongs to."
--
-- All three buckets are private (public = false) — nothing is served
-- directly by object URL without going through Supabase Storage's own
-- authenticated/signed-URL access, consistent with every other table in
-- this schema defaulting to locked-down-unless-a-member.

insert into storage.buckets (id, name, public)
values
  ('refs', 'refs', false),
  ('renders', 'renders', false),
  ('library', 'library', false)
on conflict (id) do nothing;

-- storage.objects.name is the full object path, e.g.
-- "<org_id>/<ad_id>/scene_3/image_1.png". The first path segment must be
-- an org_id the caller is a member of — checked by splitting on '/' and
-- reusing is_org_member() so this follows the exact same membership rule
-- as every table policy, not a separate parallel definition of "member".
--
-- One policy per bucket per operation (select/insert/update/delete),
-- rather than one blanket policy across all three buckets, so each
-- bucket's access rules can diverge later without disturbing the others
-- (e.g. if 'renders' ever needs a different retention/access story than
-- 'refs').

create policy refs_select on storage.objects
  for select using (
    bucket_id = 'refs'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy refs_insert on storage.objects
  for insert with check (
    bucket_id = 'refs'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy refs_update on storage.objects
  for update using (
    bucket_id = 'refs'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy refs_delete on storage.objects
  for delete using (
    bucket_id = 'refs'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy renders_select on storage.objects
  for select using (
    bucket_id = 'renders'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy renders_insert on storage.objects
  for insert with check (
    bucket_id = 'renders'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy renders_update on storage.objects
  for update using (
    bucket_id = 'renders'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy renders_delete on storage.objects
  for delete using (
    bucket_id = 'renders'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy library_select on storage.objects
  for select using (
    bucket_id = 'library'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy library_insert on storage.objects
  for insert with check (
    bucket_id = 'library'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy library_update on storage.objects
  for update using (
    bucket_id = 'library'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy library_delete on storage.objects
  for delete using (
    bucket_id = 'library'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
