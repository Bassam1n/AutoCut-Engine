-- M1: RPCs for org creation and provider-key management. Spec §2 rule 5
-- (keys live encrypted in Vault, never reach the browser/logs/payloads)
-- and §5.1 ("Key screens are write-only. They show the last 4 characters
-- and test the key with a cheap call before saving").
--
-- Confirmed against the live project before writing these: vault.secrets,
-- vault.decrypted_secrets, vault.create_secret() and vault.update_secret()
-- all exist (Supabase Vault is enabled by default). Nothing here is
-- guessed at.

-- create_org: the only way to create an org row. The creating user is
-- inserted as 'owner' in the same transaction, so there's never a window
-- where an org exists with zero members.
create or replace function public.create_org(org_name text)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  insert into public.orgs (name)
  values (org_name)
  returning * into new_org;

  insert into public.org_members (org_id, user_id, role, seat_active)
  values (new_org.id, auth.uid(), 'owner', true);

  insert into public.audit_log (org_id, actor, action, target)
  values (new_org.id, auth.uid(), 'org_created', new_org.id::text);

  return new_org;
end;
$$;

-- resume_org: only an owner/admin can lift a spend-guard pause. Logged,
-- per spec §5.10 ("Only an owner or admin can resume, and resuming is
-- logged").
create or replace function public.resume_org(target_org_id uuid)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_org public.orgs;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'only an owner or admin can resume this org';
  end if;

  update public.orgs
  set paused = false, pause_reason = null
  where id = target_org_id
  returning * into updated_org;

  insert into public.audit_log (org_id, actor, action, target)
  values (target_org_id, auth.uid(), 'org_resumed', target_org_id::text);

  return updated_org;
end;
$$;

-- save_org_secret: stores a provider API key encrypted in Vault. Returns
-- only the row metadata (id, provider, last4, verified_at) — the raw
-- key value and the vault_secret_id are never returned to the caller,
-- consistent with org_secrets having zero browser-readable policies.
-- Overwrites any existing key for that (org, provider) pair via
-- vault.update_secret when one already exists, rather than leaving an
-- orphaned Vault entry behind.
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

  -- Table-qualified (os.*), and ON CONFLICT targets the constraint by
  -- name rather than by column list — this function's own `returns
  -- table` declares a `provider` OUT parameter in scope for the whole
  -- body, which collides with org_secrets.provider. An unqualified
  -- column reference AND a spelled-out `on conflict (org_id,
  -- provider)` column list both resolve against that OUT parameter,
  -- not purely the table column — caught as "column reference
  -- 'provider' is ambiguous" the first time this was actually called
  -- end-to-end.
  --
  -- `returning os.* into row_result` (not a hand-written column list)
  -- because RETURNING-into-a-rowtype-variable assigns POSITIONALLY —
  -- a spelled-out list that isn't in the table's exact declared column
  -- order silently puts the wrong value in the wrong field. That was
  -- the next bug the same live test caught, right after fixing the
  -- ambiguity above: a hand-written RETURNING list (id, provider,
  -- last4, verified_at, org_id, ...) put the `provider` text value
  -- into row_result's 2nd slot, which is actually org_id (uuid) in
  -- org_secrets' real column order — "invalid input syntax for type
  -- uuid: 'anthropic'". Three total passes were needed to get this
  -- one statement right (00000000000024, 00000000000025,
  -- 00000000000026) — all three bugs were invisible from reading the
  -- SQL and only surfaced by actually calling the function.
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

-- mark_org_secret_verified: called by server-side code (never the
-- browser directly) after a cheap test call to the provider succeeds.
-- Kept as a separate RPC rather than folding into save_org_secret so the
-- "test the key with a cheap call before saving" step in §5.1 can be a
-- distinct, auditable action.
create or replace function public.mark_org_secret_verified(
  target_org_id uuid,
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

  update public.org_secrets
  set verified_at = now()
  where org_id = target_org_id and provider = target_provider;
end;
$$;
