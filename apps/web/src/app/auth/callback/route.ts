import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes a Supabase magic-link / invite-link sign-in. Both the
 * one-time sign-in links an admin generates for invites (spec §5.1) and
 * a direct magic-link sign-in land here with a `code` query param that
 * gets exchanged for a real session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
