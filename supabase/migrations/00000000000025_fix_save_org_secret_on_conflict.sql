-- M2: fix save_org_secret() for real this time. Migration 24's fix
-- (table-qualifying the SELECT and INSERT/RETURNING column references)
-- was necessary but not sufficient — isolated by testing each clause
-- of the function body separately against the live database:
--
-- `on conflict (org_id, provider) do update` is STILL ambiguous, even
-- with every other reference qualified, because this function's own
-- `returns table (..., provider text, ...)` declares `provider` as a
-- plpgsql variable in scope for the entire function body, and
-- Postgres's ON CONFLICT column-list target resolves against that
-- variable rather than purely against the table's column — confirmed
-- by reproducing the exact error with a throwaway `provider text`
-- local variable, then confirming the same insert/on-conflict
-- succeeds once that variable is removed. A table-qualified name
-- (`os.provider`) is not valid syntax inside an ON CONFLICT target
-- list at all, so qualifying it the way the other clauses were fixed
-- was never going to work here.
--
-- Real fix: `on conflict on constraint <name>` instead of spelling out
-- the column list — a constraint name has no OUT-parameter collision
-- to begin with. Confirmed against the live org_secrets_org_id_provider_key
-- unique constraint (see 00000000000005_org_secrets.sql's `unique
-- (org_id, provider)` table constraint, which Postgres auto-named).
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
  on conflict on constraint org_secrets_org_id_provider_key do update
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
