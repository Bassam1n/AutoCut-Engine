-- M8: "feedback -> rules -> history" distillation (spec §5.8).
-- Confirms: (1) rules still has no insert policy for a browser-role
-- caller, even the org's own owner — the new create_rule_from_feedback
-- RPC exists exactly because of this; (2) create_rule_from_feedback/
-- attach_feedback_to_rule/update_rule_decay are service-role-only, a
-- browser-role caller (even an org admin) cannot invoke them
-- directly; (3) rules_admin_update/rules_admin_delete still work as
-- the rules screen's edit/pause/delete actions rely on, and a non-
-- admin editor is rejected by the same policies; (4) the service role
-- CAN create a rule via the RPC and it correctly attaches member
-- feedback_events rows via rule_id.
--
-- Run with: supabase test db --db-url <...> supabase/tests/007_rules_distillation.sql

begin;
select plan(11);

insert into auth.users (id, email, aud, role)
values
  ('d0000000-0000-0000-0000-000000000001', 'rules-owner@example.invalid', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'rules-editor@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values ('d1111111-1111-1111-1111-111111111111', '__test_org_rules_distillation');

insert into public.org_members (org_id, user_id, role, seat_active)
values
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true),
  ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000002', 'editor', true);

insert into public.brands (id, org_id, name)
values ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', '__brand_rules_test');

insert into public.products (id, org_id, brand_id, name)
values ('d7777777-7777-7777-7777-777777777777', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', '__product_rules_test');

insert into public.ads (id, org_id, brand_id, product_id, mode)
values ('d3333333-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'd7777777-7777-7777-7777-777777777777', 'studio');

insert into public.feedback_events (id, org_id, ad_id, target, mode, text, remember)
values
  ('d4444444-4444-4444-4444-444444444444', 'd1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333', 'image', 'tweak', 'make her smile more', true),
  ('d4444444-4444-4444-4444-444444444445', 'd1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333', 'image', 'tweak', 'needs a bigger smile', true);

-- Impersonate this org's own owner (the most generous non-service
-- case) for the insert-policy test.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

select throws_ok(
  $$ insert into public.rules (org_id, scope, scope_id, kind, text) values ('d1111111-1111-1111-1111-111111111111', 'org', null, 'do', 'DO: test rule') $$,
  '42501',
  null,
  'org owner cannot INSERT directly into rules — no insert policy exists, confirming create_rule_from_feedback is the only path'
);

-- create_rule_from_feedback is service-role-only: an org admin
-- calling it directly (not as service_role) is rejected.
select throws_ok(
  $$ select public.create_rule_from_feedback('d1111111-1111-1111-1111-111111111111'::uuid, 'org', null, 'do', 'DO: test', array['d4444444-4444-4444-4444-444444444444'::uuid]) $$,
  'P0001',
  'create_rule_from_feedback can only be called by the service role',
  'an org owner (authenticated, not service_role) cannot call create_rule_from_feedback directly'
);

select throws_ok(
  $$ select public.attach_feedback_to_rule('d1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid, array['d4444444-4444-4444-4444-444444444444'::uuid]) $$,
  'P0001',
  'attach_feedback_to_rule can only be called by the service role',
  'an org owner cannot call attach_feedback_to_rule directly'
);

select throws_ok(
  $$ select public.update_rule_decay('d4444444-4444-4444-4444-444444444444'::uuid, 0.5, true, 0) $$,
  'P0001',
  'update_rule_decay can only be called by the service role',
  'an org owner cannot call update_rule_decay directly'
);

-- Switch to the actual service role to exercise the real RPC path.
reset role;
select set_config('request.jwt.claims', '', true);
set role service_role;

select lives_ok(
  $$ select public.create_rule_from_feedback(
       'd1111111-1111-1111-1111-111111111111'::uuid,
       'brand',
       'd2222222-2222-2222-2222-222222222222'::uuid,
       'do',
       'DO: give the main subject a warm, visible smile',
       array['d4444444-4444-4444-4444-444444444444'::uuid, 'd4444444-4444-4444-4444-444444444445'::uuid]
     ) $$,
  'service role can create a rule via create_rule_from_feedback'
);

select is(
  (select count(*)::int from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand'),
  1,
  'exactly one brand-scoped rule now exists'
);

select is(
  (select count(*)::int from public.feedback_events where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and rule_id is not null),
  2,
  'both member feedback_events rows are now attached to the new rule via rule_id'
);

-- Back to the authenticated org members for the admin edit/pause/
-- delete policy checks.
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

update public.rules set active = false where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand';
select is(
  (select active from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand'),
  true,
  'a non-admin editor cannot pause (update) a rule — rules_admin_update rejects it, row stays active'
);

delete from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand';
select is(
  (select count(*)::int from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand'),
  1,
  'a non-admin editor cannot delete a rule — rules_admin_delete rejects it, row survives'
);

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

update public.rules set active = false where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand';
select is(
  (select active from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand'),
  false,
  'the org owner (admin) CAN pause a rule'
);

delete from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand';
select is(
  (select count(*)::int from public.rules where org_id = 'd1111111-1111-1111-1111-111111111111'::uuid and scope = 'brand'),
  0,
  'the org owner (admin) CAN delete a rule'
);

select * from finish();
rollback;
