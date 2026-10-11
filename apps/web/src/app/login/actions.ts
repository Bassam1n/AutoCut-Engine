"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Requests a magic-link sign-in email for self-serve sign-in. This is
 * the fallback path for "I already have an account and know my email" —
 * distinct from the invite flow (spec §5.1), which generates a one-time
 * link server-side via the admin API and is delivered by an admin
 * directly rather than through Supabase's own email sending, per the
 * spec's "do not depend on email delivery" requirement. This path DOES
 * depend on Supabase's email delivery, which is acceptable here because
 * it's a convenience re-entry path, not the only way into the app —
 * the invite flow (built next) is.
 */
export async function requestMagicLink(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
