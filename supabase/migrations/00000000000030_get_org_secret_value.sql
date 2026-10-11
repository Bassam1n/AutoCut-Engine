-- M3: get_org_secret_value — the read path provider adapter calls
-- actually need. save_org_secret()/mark_org_secret_verified()
-- (00000000000013) cover writing a key; nothing before this migration
-- let server-side code read the decrypted value back out to use in a
-- real provider API call, which is the entire point of storing it.
--
-- vault.decrypted_secrets is intentionally NOT exposed over PostgREST
-- (confirmed live: calling supabase.schema('vault') from the service
-- client fails with "Invalid schema: vault" — Vault's schema is
-- deliberately kept off the REST API surface). This RPC is the
-- sanctioned way through: SECURITY DEFINER, callable only by the
-- service role (never authenticated/anon — an org member must never
-- be able to read back a raw provider key, only an owner/admin saving
-- a NEW key, which never reads the old one), returning the plaintext
-- value for in-process use by server-side generation code. The value
-- must never be logged, returned to the browser, or persisted
-- anywhere outside this one call's return value.
create or replace function public.get_org_secret_value(
  target_org_id uuid,
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
    raise exception 'get_org_secret_value can only be called by the service role';
  end if;

  select ds.decrypted_secret into secret_value
  from public.org_secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  where s.org_id = target_org_id and s.provider = target_provider;

  if secret_value is null then
    raise exception 'no saved key for org % provider %', target_org_id, target_provider;
  end if;

  return secret_value;
end;
$$;

-- No grant to anon/authenticated — only the service role (which
-- bypasses grants entirely via its superuser-equivalent Postgres role
-- in Supabase) can call this, matching the "only server-side
-- generation code, never the browser" requirement above.
revoke execute on function public.get_org_secret_value(uuid, text) from anon, authenticated;
