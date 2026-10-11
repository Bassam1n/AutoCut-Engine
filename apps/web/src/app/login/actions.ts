"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Sign-in only — there is no self-serve signup path in this app. A new
 * agency only comes into existence when a platform admin registers it
 * (see /platform-admin), which creates a pending_invites row for the
 * owner's email. A new team member only gets access when their org's
 * own admin invites them (same mechanism, different inviter).
 *
 * Before ever calling Supabase's signInWithOtp — which would otherwise
 * silently create a brand-new Auth user for ANY email typed in, the
 * actual hole the user caught — this checks email_is_known_for_signin()
 * first. An email with no existing account and no pending invite never
 * reaches signInWithOtp at all: no Auth user gets created, no email
 * gets sent, and the UI shows the same "check your email" outcome
 * either way so this never confirms or denies whether a given email is
 * a real account (standard practice against account enumeration).
 */
export async function requestMagicLink(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();

  const { data: isKnown, error: checkError } = await supabase.rpc(
    "email_is_known_for_signin",
    { check_email: email }
  );

  if (checkError) {
    return { ok: false, error: "Something went wrong. Try again." };
  }

  if (!isKnown) {
    // Same success response as a real send — never confirms or denies
    // whether a given email is a real account (account enumeration).
    return { ok: true };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
