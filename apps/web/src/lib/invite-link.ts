import "server-only";
import { createServiceClient } from "./supabase/service";

/**
 * A sign-in link for an invited email, to copy and send over WhatsApp,
 * email, anywhere. "invite" creates the account on first use; for
 * someone who already has an account (e.g. joining a second agency)
 * Supabase rejects it, so fall back to a regular magic link.
 *
 * IMPORTANT: this intentionally does NOT return Supabase's raw
 * action_link. That URL consumes its one-time token on the first GET,
 * and messaging apps (WhatsApp link previews) and email scanners fetch
 * links before the human ever taps — which burned real invites as
 * "expired". Instead we link to our own /auth/accept page carrying the
 * token HASH; the token is only consumed when the person presses the
 * button there (verifyOtp), which no preview bot does.
 */
export async function generateSignInLink(email: string): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const service = createServiceClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

  const toAcceptUrl = (props: { hashed_token: string; verification_type: string }) =>
    `${site}/auth/accept?token_hash=${encodeURIComponent(props.hashed_token)}&type=${encodeURIComponent(props.verification_type)}`;

  const invite = await service.auth.admin.generateLink({ type: "invite", email });
  if (!invite.error && invite.data) return { ok: true, link: toAcceptUrl(invite.data.properties) };

  const magic = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (!magic.error && magic.data) return { ok: true, link: toAcceptUrl(magic.data.properties) };

  return { ok: false, error: magic.error?.message ?? invite.error?.message ?? "Couldn't generate a sign-in link." };
}

/**
 * Owner-safe variant: only type "invite", which Supabase refuses when
 * the email already has an account. NO magiclink fallback — an org
 * owner must never be able to mint a working sign-in link for an
 * existing user's account (that would be account takeover of someone
 * who might belong to other agencies). Returns user_exists so the UI
 * can explain; that person signs in themselves at /login and the
 * pending invite attaches on their next sign-in.
 */
export async function generateNewAccountInviteLink(
  email: string
): Promise<{ ok: true; link: string } | { ok: false; userExists: boolean; error: string }> {
  const service = createServiceClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

  const invite = await service.auth.admin.generateLink({ type: "invite", email });
  if (!invite.error && invite.data) {
    const props = invite.data.properties;
    return {
      ok: true,
      link: `${site}/auth/accept?token_hash=${encodeURIComponent(props.hashed_token)}&type=${encodeURIComponent(props.verification_type)}`,
    };
  }
  const userExists = (invite.error?.message ?? "").toLowerCase().includes("already");
  return { ok: false, userExists, error: invite.error?.message ?? "Couldn't generate a link." };
}
