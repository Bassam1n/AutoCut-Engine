import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Emails someone a sign-in link through the project's SMTP.
 *
 * Uses a throwaway, cookie-less anon client on purpose. Calling
 * signInWithOtp on the request's own Supabase client (a) ties the PKCE
 * verifier to whoever is making the request (for a team invite: the
 * OWNER's browser, so the invitee's link can never complete) and (b)
 * writes auth cookies into that person's session. Implicit flow plus the
 * email templates pointing at /auth/accept?token_hash=... means the link
 * works in any browser, on any device, and survives mail scanners, since
 * the token is only spent when the person presses Continue.
 */
export async function sendSignInEmail(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, error: "Supabase isn't configured." };

  const sender = createSupabaseClient(url, anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const { error } = await sender.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${site}/auth/callback` },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
