-- M2: email_is_known_for_signin — the actual gate that prevents /login
-- from being a backdoor signup form. Called by requestMagicLink() BEFORE
-- ever calling supabase.auth.signInWithOtp(), so an email with no
-- active org_members row and no pending invite never reaches Supabase
-- Auth's own signInWithOtp call at all — no new auth.users row gets
-- created for it, no email gets sent.
--
-- This is intentionally a narrow boolean check, not a general-purpose
-- "look up a member by email" RPC: it answers exactly one question
-- (should this email be allowed through the sign-in door) and reveals
-- nothing else, callable by anon (no auth.uid() required — the whole
-- point is this runs before anyone is signed in).
create or replace function public.email_is_known_for_signin(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from auth.users where lower(email) = lower(check_email)
    )
    or exists (
      select 1 from public.pending_invites
      where lower(email) = lower(check_email) and accepted_at is null
    );
$$;

grant execute on function public.email_is_known_for_signin(text) to anon, authenticated;
