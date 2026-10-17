import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/**
 * Completes a Supabase sign-in link. The PKCE flow (what this app's own
 * /login form produces, via @supabase/ssr's browser/server clients,
 * which default to flowType: "pkce") lands here with a `?code=` query
 * param, handled below.
 *
 * A link generated the implicit-flow way instead (confirmed: this
 * happens with the plain @supabase/supabase-js admin client's
 * generateLink(), which defaults to flowType: "implicit" per
 * GoTrueClient.js — hit this for real while hand-generating a link to
 * work around Supabase's email rate limit) carries its tokens in the
 * URL FRAGMENT instead (#access_token=...), which a server route
 * handler can never see — fragments are never part of an HTTP request,
 * full stop, not a framework limitation. When there's no `code`, this
 * redirects to /auth/callback/implicit, a client page that reads the
 * fragment and completes the session in the browser instead. Browsers
 * preserve the fragment across a same-origin redirect automatically
 * (standard navigation behavior — this is why OAuth implicit-flow
 * libraries rely on the same pattern), so the tokens survive the hop.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // See accept_invite()'s own doc comment in
      // supabase/migrations/00000000000017_platform_admins.sql.
      // no_pending_invite_for_email is expected on every sign-in after
      // the first — confirmed via a real supabase-js RPC call (not
      // raw SQL) that this surfaces as { error: { message: "..." } },
      // never a thrown exception.
      const { error: acceptError } = await supabase.rpc("accept_invite");
      if (acceptError && acceptError.message !== "no_pending_invite_for_email") {
        console.error("accept_invite failed unexpectedly:", acceptError);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // No code param — might be an implicit-flow link with tokens in the
  // fragment. Redirect there; the fragment (invisible to us here)
  // travels with the browser's navigation regardless of what this
  // Location header says.
  return NextResponse.redirect(
    `${origin}/auth/callback/implicit?next=${encodeURIComponent(next)}`
  );
}
