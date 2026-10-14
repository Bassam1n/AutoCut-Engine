import "server-only";
import { createServiceClient } from "./supabase/service";

/**
 * A one-time sign-in link for an invited email, to copy and send.
 * "invite" creates the account on first use; for someone who already
 * has an account (e.g. joining a second agency) Supabase rejects it,
 * so fall back to a regular magic link. Either way, signing in through
 * it lands on /auth/callback, which accepts the pending invite.
 */
export async function generateSignInLink(email: string): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const service = createServiceClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;

  const invite = await service.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (!invite.error && invite.data) return { ok: true, link: invite.data.properties.action_link };

  const magic = await service.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  if (!magic.error && magic.data) return { ok: true, link: magic.data.properties.action_link };

  return { ok: false, error: magic.error?.message ?? invite.error?.message ?? "Couldn't generate a sign-in link." };
}
