"use server";

import { createClient } from "@/lib/supabase/server";
import { generateSignInLink } from "@/lib/invite-link";
import { requirePlatformAdmin } from "@/lib/auth";

export type RegisterAgencyResult =
  | { ok: true; orgId: string; inviteLink: string }
  | { ok: false; error: string };

/**
 * The only way a new agency/org comes into existence (see spec's
 * onboarding model — no self-serve signup). Re-checks platform-admin
 * status itself rather than trusting the page that rendered the form,
 * per ADR 001's "Authorization is re-checked server-side in every
 * Server Action" rule — the UI gating on requirePlatformAdmin() is not
 * itself a security boundary, this check is.
 *
 * Two-step: register_agency() (the DB RPC) creates the org +
 * pending_invites row using the anon-key session client (so it's
 * properly attributed to the calling platform admin via auth.uid()).
 * Then the SERVICE-role client calls Supabase's admin.generateLink() to
 * produce a real one-time sign-in URL — this needs the service role
 * because generateLink is an admin-only Auth API call, unrelated to our
 * own RLS. The link is returned directly to the UI to copy/send
 * manually, never emailed by Supabase — spec §5.1's "do not depend on
 * email delivery."
 */
export async function registerAgency(
  formData: FormData
): Promise<RegisterAgencyResult> {
  await requirePlatformAdmin();

  const orgName = String(formData.get("orgName") ?? "").trim();
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim();

  if (!orgName) {
    return { ok: false, error: "Enter an agency/org name." };
  }
  if (!ownerEmail || !ownerEmail.includes("@")) {
    return { ok: false, error: "Enter a valid owner email." };
  }

  const supabase = await createClient();
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc("register_agency", { org_name: orgName, owner_email: ownerEmail })
    .single<{ org_id: string; invite_id: string }>();

  if (rpcError || !rpcResult) {
    return { ok: false, error: rpcError?.message ?? "Could not register agency." };
  }

  const link = await generateSignInLink(ownerEmail.toLowerCase());
  if (!link.ok) {
    return {
      ok: false,
      error: `Agency created, but the invite link couldn't be generated: ${link.error}. Open the agency and use "New link" on the pending invite.`,
    };
  }

  return {
    ok: true,
    orgId: rpcResult.org_id,
    inviteLink: link.link,
  };
}
