-- brand_secrets mirrors org_secrets' own isolation test
-- (002_browser_role_write_restrictions.sql's org_secrets section)
-- exactly: zero RLS policies means even the owning org's own admin
-- cannot see or write a row directly, regardless of org/brand
-- membership — every access must go through the security-definer
-- RPCs. Also proves get_brand_secret_value's fallback chain: a brand
-- with no key of its own still resolves to its org's key, so adding
-- per-brand keys never breaks an org that hasn't set any up.

begin;
select plan(9);

insert into auth.users (id, email, aud, role)
values ('d0000000-0000-0000-0000-000000000001', 'brand-secrets-test-user@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values ('d1111111-1111-1111-1111-111111111111', '__test_org_brand_secrets');

insert into public.org_members (org_id, user_id, role, seat_active)
values ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true);

insert into public.brands (id, org_id, name)
values ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', '__brand_secrets_test');

-- Fixtures for the fallback-chain assertions below (real Vault-backed
-- secrets, written via the RPCs so get_brand_secret_value can actually
-- resolve a real decrypted_secrets row end to end), written while
-- still impersonating the owning user but before the RLS-visibility
-- assertions switch to proving the DIRECT-table-write path is blocked.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select lives_ok(
  $$ select public.save_brand_secret('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'elevenlabs', 'brand-level-key-value') $$,
  'save_brand_secret succeeds for the fallback fixture'
);

select lives_ok(
  $$ select public.save_org_secret('d1111111-1111-1111-1111-111111111111', 'elevenlabs', 'org-level-key-should-be-shadowed') $$,
  'save_org_secret succeeds for the shadowed-fallback fixture (elevenlabs: brand-level key exists, so this must never be returned)'
);

select lives_ok(
  $$ select public.save_org_secret('d1111111-1111-1111-1111-111111111111', 'fal', 'org-level-fallback-key-value') $$,
  'save_org_secret succeeds for the fallback fixture (fal: no brand-level key exists, so this is what must be returned)'
);

select is(
  (select count(*)::int from public.brand_secrets where brand_id = 'd2222222-2222-2222-2222-222222222222'),
  0,
  'org owner CANNOT even see that their own brand has a saved secret — brand_secrets has zero select policy, by design'
);

select throws_ok(
  $$ insert into public.brand_secrets (org_id, brand_id, provider, vault_secret_id, last4) values ('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'twelvelabs', gen_random_uuid(), '9999') $$,
  '42501', null,
  'org owner CANNOT insert into brand_secrets directly — save_brand_secret() RPC is the only path'
);

update public.brand_secrets set last4 = '0000' where brand_id = 'd2222222-2222-2222-2222-222222222222' and provider = 'elevenlabs';
select is(
  (select last4 from public.brand_secrets where brand_id = 'd2222222-2222-2222-2222-222222222222' and provider = 'elevenlabs'),
  null,
  'org owner cannot even confirm whether their UPDATE on brand_secrets did anything — the row stays invisible'
);

reset role;

-- auth.role() reads the request.jwt.claims GUC, not the real Postgres
-- session role — plain `reset role`/`set_config('role', ...)` has no
-- effect on it, confirmed against get_org_secret_value's identical
-- gate by running this test. This is the one way to make it return
-- 'service_role' from a plain psql/pgTAP connection.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select public.get_brand_secret_value('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'elevenlabs')),
  (select ds.decrypted_secret from public.brand_secrets s join vault.decrypted_secrets ds on ds.id = s.vault_secret_id where s.brand_id = 'd2222222-2222-2222-2222-222222222222' and s.provider = 'elevenlabs'),
  'get_brand_secret_value returns the BRAND-level key when one exists, not the org-level fallback'
);

select is(
  (select public.get_brand_secret_value('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'fal')),
  (select ds.decrypted_secret from public.org_secrets s join vault.decrypted_secrets ds on ds.id = s.vault_secret_id where s.org_id = 'd1111111-1111-1111-1111-111111111111' and s.provider = 'fal'),
  'get_brand_secret_value falls back to the ORG-level key when no brand-level key exists for this provider — backward compatible with every org that has not set up per-brand keys'
);

select throws_ok(
  $$ select public.get_brand_secret_value('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'kie') $$,
  'P0001', null,
  'get_brand_secret_value raises when neither a brand-level nor an org-level key exists for this provider'
);

reset role;
select * from finish();
rollback;
