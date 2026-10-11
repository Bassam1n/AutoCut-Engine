import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes a Supabase sign-in link. Every first-time sign-in — whether
 * it's a platform admin's own account or an invited agency owner/editor
 * clicking their invite link — lands here with a `code` query param.
 *
 * After exchanging the code for a session, calls accept_invite() (see
 * supabase/migrations/00000000000017_platform_admins.sql): converts a
 * matching pending_invites row into a real org_members row on first
 * sign-in.
 *
 * accept_invite() raises no_pending_invite_for_email (via plpgsql
 * `raise exception`) whenever there's nothing to do — a returning user
 * who already accepted their invite on a prior sign-in, or a platform
 * admin's own account (never invited to any org). Confirmed directly
 * against the live database (ran accept_invite() twice for the same
 * test user: first call converted the invite, second call raised this
 * exact error) that this is the normal, expected outcome on every
 * sign-in after the first — not a bug to surface, which is why it's
 * explicitly swallowed below rather than left to an unverified
 * assumption about how supabase-js surfaces a plpgsql exception.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { error: acceptError } = await supabase.rpc("accept_invite");
      if (acceptError && acceptError.message !== "no_pending_invite_for_email") {
        // An unexpected failure here shouldn't silently drop the user
        // into a half-signed-in state — log it server-side. The session
        // itself is still valid, so still redirect rather than bounce
        // them back to /login.
        console.error("accept_invite failed unexpectedly:", acceptError);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
