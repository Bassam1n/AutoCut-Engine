-- M2: fix save_org_secret(), third and (confirmed) final pass. After
-- 00000000000025 fixed the ON CONFLICT ambiguity, the very next live
-- test still failed with "invalid input syntax for type uuid:
-- 'anthropic'" — a different bug in the same statement.
--
-- Root cause, isolated by checkpointing each clause separately against
-- the live database: `returning os.id, os.provider, os.last4,
-- os.verified_at, os.org_id, os.vault_secret_id, os.created_at,
-- os.updated_at into row_result` assigns POSITIONALLY into
-- row_result's declared type (public.org_secrets), whose real column
-- order is (id, org_id, provider, vault_secret_id, last4,
-- verified_at, created_at, updated_at) — NOT the order the RETURNING
-- list happened to spell them out in. Position 2 of the RETURNING
-- list (`os.provider`, a text value) was landing in row_result's
-- position-2 slot, which is org_id (uuid) — hence a text value like
-- 'anthropic' failing to parse as a uuid.
--
-- Fixed by using `returning os.* into row_result`, which assigns by
-- matching the row type's own columns rather than relying on a
-- hand-written list to happen to be in the right order. This is the
-- correct general pattern any time RETURNING targets a `%ROWTYPE`
-- variable — spelling out columns there is a footgun, not just
-- unnecessary.
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
  returning os.* into row_result;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'org_secret_saved', target_provider);

  return query select row_result.id, row_result.provider, row_result.last4, row_result.verified_at;
end;
$$;
