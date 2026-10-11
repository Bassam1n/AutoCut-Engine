-- M2: list_org_secrets — the read side of provider key management that
-- 00000000000013_rpc_orgs_secrets.sql's save_org_secret()/
-- mark_org_secret_verified() never needed on their own (they write and
-- return their own result row). The key screen needs to show which
-- providers already have a key saved, with its last4 and verification
-- status, before the admin decides what to add or replace — without
-- this, the UI has no way to render that state at all.
--
-- Returns metadata only (provider, last4, verified_at, created_at) —
-- never vault_secret_id, and never anything that could reconstruct the
-- actual key. Same is_org_admin() gate as the write-side RPCs, and
-- scoped to the caller's own org only.
create or replace function public.list_org_secrets(target_org_id uuid)
returns table (
  provider text,
  last4 text,
  verified_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can view provider key status';
  end if;

  return query
    select s.provider, s.last4, s.verified_at, s.created_at
    from public.org_secrets s
    where s.org_id = target_org_id
    order by s.provider;
end;
$$;
