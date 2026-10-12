-- M8 feedback (spec §5.8). feedback_events is append-only by design —
-- migration 00000000000010_feedback_library.sql gives it only select
-- and insert policies, no update or delete policy at all, matching
-- the project's standing "archive, never delete/mutate" convention
-- for generated-history rows. This test confirms that holds for a
-- real org member (not just an outsider), the same "most generous
-- case" pattern 002_browser_role_write_restrictions.sql already uses
-- for gates/jobs/assets/org_secrets.

begin;
select plan(5);

insert into auth.users (id, email, aud, role)
values ('d0000000-0000-0000-0000-000000000001', 'feedback-test-user@example.invalid', 'authenticated', 'authenticated');

insert into public.orgs (id, name)
values ('d1111111-1111-1111-1111-111111111111', '__test_org_feedback_events');

insert into public.org_members (org_id, user_id, role, seat_active)
values ('d1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000001', 'owner', true);

insert into public.brands (id, org_id, name)
values ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', '__brand_feedback_test');

insert into public.products (id, org_id, brand_id, name)
values ('d7777777-7777-7777-7777-777777777777', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', '__product_feedback_test');

insert into public.ads (id, org_id, brand_id, product_id, mode)
values ('d3333333-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'd7777777-7777-7777-7777-777777777777', 'studio');

-- Impersonate this org's own owner — the most generous case for
-- testing a restriction: if even the org's own owner cannot update or
-- delete a feedback_events row, the append-only guarantee is real.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);

-- insert: org member CAN insert their own feedback (spec §5.8: the
-- editor submits feedback directly from the Studio UI).
insert into public.feedback_events (id, org_id, ad_id, target, mode, text, remember)
values ('d4444444-4444-4444-4444-444444444444', 'd1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333', 'image', 'tweak', 'make the mug blue', false);

select is(
  (select count(*)::int from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444'),
  1,
  'org owner CAN insert their own feedback_events row'
);

-- update: no update policy exists at all — per the
-- 002_browser_role_write_restrictions.sql Postgres-semantics note,
-- an UPDATE whose WHERE clause can't match due to RLS does not
-- throw, it just updates 0 rows — so the real assertion is "the row
-- is unchanged afterward," not throws_ok().
update public.feedback_events set text = 'tampered' where id = 'd4444444-4444-4444-4444-444444444444';
select is(
  (select text from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444'),
  'make the mug blue',
  'org owner''s direct UPDATE on feedback_events did not apply — text is unchanged, feedback is append-only'
);

update public.feedback_events set remember = true where id = 'd4444444-4444-4444-4444-444444444444';
select is(
  (select remember from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444'),
  false,
  'org owner''s direct UPDATE on feedback_events.remember did not apply either — no field is mutable after insert'
);

-- delete: same no-policy-at-all story — DELETE with no matching
-- policy deletes 0 rows rather than throwing.
delete from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444';
select is(
  (select count(*)::int from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444'),
  1,
  'org owner''s direct DELETE on feedback_events did not apply — the row survives, feedback_events has no delete policy'
);

-- select: org member can still read it back (needed for the history
-- strip spec §5.8 names).
select is(
  (select mode from public.feedback_events where id = 'd4444444-4444-4444-4444-444444444444'),
  'tweak',
  'org owner can read back their own feedback_events row unchanged'
);

select * from finish();
rollback;
