-- Higgsfield account logins (brand secret "higgsfield_plan") hold OAuth
-- tokens that the server refreshes during generation, including inside
-- the Trigger.dev job runner, which runs with the service role and has
-- no signed-in admin for save_brand_secret's is_org_admin() check.
--
-- This lets the service role replace an EXISTING higgsfield_plan secret
-- (never create one, never any other provider): connecting an account
-- still requires an admin through save_brand_secret. Execute is revoked
-- from PUBLIC, anon and authenticated, per migration 064's convention.

create or replace function public.service_update_higgsfield_plan_secret(
  target_org_id uuid,
  target_brand_id uuid,
  secret_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_vault_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;

  if length(secret_value) < 4 then
    raise exception 'secret value too short';
  end if;

  select s.vault_secret_id into existing_vault_id
  from public.brand_secrets s
  where s.org_id = target_org_id
    and s.brand_id = target_brand_id
    and s.provider = 'higgsfield_plan';

  if existing_vault_id is null then
    raise exception 'no Higgsfield account is connected for this brand';
  end if;

  perform vault.update_secret(existing_vault_id, secret_value);

  update public.brand_secrets
  set last4 = right(secret_value, 4), updated_at = now()
  where org_id = target_org_id and brand_id = target_brand_id and provider = 'higgsfield_plan';
end;
$$;

revoke execute on function public.service_update_higgsfield_plan_secret(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.service_update_higgsfield_plan_secret(uuid, uuid, text) to service_role;
