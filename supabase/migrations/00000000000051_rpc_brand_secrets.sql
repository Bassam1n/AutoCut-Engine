-- M-brand-keys: RPCs for brand-level provider keys. Mirrors
-- 00000000000013_rpc_orgs_secrets.sql / 00000000000023_list_org_secrets.sql
-- / 00000000000026_fix_save_org_secret_returning_order.sql /
-- 00000000000030_get_org_secret_value.sql exactly, scoped to a brand
-- instead of a whole org. Written directly against the column-order
-- footgun those migrations already hit and fixed (RETURNING into a
-- %ROWTYPE variable assigns positionally — always `returning bs.* into
-- row_result`, never a hand-written column list) rather than
-- rediscovering it.

-- is_org_admin(org_id) is reused as the authorization gate rather than
-- inventing a brand-level role: this app has no such thing as a
-- brand-scoped admin today (org_members carries the only role), and a
-- brand always belongs to exactly one org, so "org admin of the brand's
-- own org" is the correct and only available check.
create or replace function public.save_brand_secret(
  target_org_id uuid,
  target_brand_id uuid,
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
  row_result public.brand_secrets;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can manage provider keys';
  end if;

  -- Table-qualified (b.id/b.org_id) — this function's own `returns
  -- table` declares an `id` OUT parameter in scope for the whole body,
  -- which collides with an unqualified `id`/`org_id` reference here the
  -- exact same way save_org_secret's own `provider` OUT parameter
  -- collided with an unqualified column reference (see
  -- 00000000000024_fix_save_org_secret_ambiguous_column.sql).
  if not exists (
    select 1 from public.brands b where b.id = target_brand_id and b.org_id = target_org_id
  ) then
    raise exception 'brand does not belong to this org';
  end if;

  if length(secret_value) < 4 then
    raise exception 'secret value too short';
  end if;

  secret_name := 'brand_secret:' || target_brand_id::text || ':' || target_provider;

  select s.vault_secret_id into existing_vault_id
  from public.brand_secrets s
  where s.brand_id = target_brand_id and s.provider = target_provider;

  if existing_vault_id is not null then
    perform vault.update_secret(existing_vault_id, secret_value);
    new_vault_id := existing_vault_id;
  else
    new_vault_id := vault.create_secret(secret_value, secret_name);
  end if;

  insert into public.brand_secrets as bs (org_id, brand_id, provider, vault_secret_id, last4)
  values (
    target_org_id, target_brand_id, target_provider, new_vault_id,
    right(secret_value, 4)
  )
  on conflict on constraint brand_secrets_brand_id_provider_key do update
    set vault_secret_id = excluded.vault_secret_id,
        last4 = excluded.last4,
        verified_at = null
  returning bs.* into row_result;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'brand_secret_saved', target_brand_id::text || ':' || target_provider);

  return query select row_result.id, row_result.provider, row_result.last4, row_result.verified_at;
end;
$$;

create or replace function public.mark_brand_secret_verified(
  target_org_id uuid,
  target_brand_id uuid,
  target_provider text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can verify provider keys';
  end if;

  update public.brand_secrets
  set verified_at = now()
  where brand_id = target_brand_id and provider = target_provider;
end;
$$;

create or replace function public.list_brand_secrets(target_org_id uuid, target_brand_id uuid)
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
    from public.brand_secrets s
    where s.brand_id = target_brand_id and s.org_id = target_org_id
    order by s.provider;
end;
$$;

-- get_brand_secret_value: the read path provider adapters call.
-- FALLBACK CHAIN (the key backward-compatibility requirement): if no
-- brand-level key is saved for (brand_id, provider), this falls back
-- to the org-level key via get_org_secret_value's identical
-- Vault-resolution logic, so every org that hasn't set up per-brand
-- keys keeps working exactly as it does today — adding brand_secrets
-- is additive, never a breaking change for an existing org. Inlines
-- the same decrypted_secrets join get_org_secret_value uses (rather
-- than calling it as a nested function) so a single "no key saved for
-- this org or brand" exception message can be raised once, after both
-- tiers have been tried — calling it and catching its raised exception
-- would work too, but duplicating the join here keeps the error
-- message and control flow in one place rather than splitting it
-- across a try/catch over a function call whose exception message
-- talks about "org" when the caller asked about a brand.
create or replace function public.get_brand_secret_value(
  target_org_id uuid,
  target_brand_id uuid,
  target_provider text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret_value text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'get_brand_secret_value can only be called by the service role';
  end if;

  select ds.decrypted_secret into secret_value
  from public.brand_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.brand_id = target_brand_id and s.provider = target_provider;

  if secret_value is not null then
    return secret_value;
  end if;

  select ds.decrypted_secret into secret_value
  from public.org_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = target_org_id and s.provider = target_provider;

  if secret_value is null then
    raise exception 'no saved key for brand % or org % provider %', target_brand_id, target_org_id, target_provider;
  end if;

  return secret_value;
end;
$$;

revoke execute on function public.save_brand_secret(uuid, uuid, text, text) from anon, authenticated;
revoke execute on function public.mark_brand_secret_verified(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.get_brand_secret_value(uuid, uuid, text) from anon, authenticated;

-- list_brand_secrets stays callable by authenticated (same as
-- list_org_secrets) — it's gated by is_org_admin() inside the
-- function body, not by a REVOKE, since the key screen's Server Action
-- calls it through the user's own authenticated Supabase client, not
-- the service-role client.
