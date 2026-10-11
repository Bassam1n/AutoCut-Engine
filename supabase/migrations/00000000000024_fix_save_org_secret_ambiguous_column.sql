-- M2: fix save_org_secret() — "column reference 'provider' is
-- ambiguous" on first real end-to-end test. The function's own
-- `returns table (..., provider text, ...)` declares `provider` as an
-- OUT parameter in scope for the whole function body, which collides
-- with org_secrets.provider in the WHERE/ON CONFLICT clauses below.
-- Same class of bug as 00000000000020's auth.users.email fix — caught
-- by actually calling the RPC, not by reading the SQL. Fixed by
-- table-qualifying every column reference that could collide with an
-- OUT parameter name (org_id/provider), not just the ones Postgres
-- currently flags, so a future OUT parameter rename doesn't reopen
-- the same bug silently.
create or replace function public.save_org_secret(
  target_org_id uuid,
  target_provider text,
  secret_value text
)
returns table (
  id uuid,
  provider text,
  last4 text,
  verified_at timestamptz
)
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
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can manage provider keys';
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
  values (
    target_org_id, target_provider, new_vault_id,
    right(secret_value, 4)
  )
  on conflict (org_id, provider) do update
    set vault_secret_id = excluded.vault_secret_id,
        last4 = excluded.last4,
        verified_at = null
  returning os.id, os.provider, os.last4, os.verified_at, os.org_id, os.vault_secret_id, os.created_at, os.updated_at
    into row_result;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'org_secret_saved', target_provider);

  return query select row_result.id, row_result.provider, row_result.last4, row_result.verified_at;
end;
$$;
