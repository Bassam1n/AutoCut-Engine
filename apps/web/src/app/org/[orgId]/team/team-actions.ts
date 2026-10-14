"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin, requireOrgOwner } from "@/lib/auth";
import { changeUserEmail } from "@/lib/change-email";
import { generateNewAccountInviteLink } from "@/lib/invite-link";
import { requestOrigin } from "@/lib/site-url";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type InviteResult =
  | { ok: true; link: string | null; emailed: boolean; userExists: boolean }
  | { ok: false; error: string };

/**
 * Emails the invitee a sign-in link (magic link through our SMTP) and,
 * for brand-new accounts only, returns a copyable /auth/accept link the
 * owner can send over WhatsApp. Both best-effort: the invite row is
 * already stored, and the invitee can always request a link themselves
 * on /login (their email is now "known" to the sign-in gate).
 */
async function deliverInvite(email: string): Promise<{ link: string | null; emailed: boolean; userExists: boolean }> {
  const supabase = await createClient();
  const { error: emailError } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/callback`, shouldCreateUser: true },
  });

  const linkResult = await generateNewAccountInviteLink(email);
  return {
    link: linkResult.ok ? linkResult.link : null,
    emailed: !emailError,
    userExists: !linkResult.ok && linkResult.userExists,
  };
}

type AssignableRole = "admin" | "editor";

const FRIENDLY_ERRORS: Record<string, string> = {
  seat_cap_not_configured:
    "Your seat limit hasn't been set yet. Ask the platform admin to configure it.",
  seat_cap_reached:
    "You've reached your team's seat limit. Deactivate a seat or ask the platform admin to raise the limit.",
};

function friendlyError(message: string): string {
  return FRIENDLY_ERRORS[message] ?? message;
}

// Team management is owner-only (migration 52). requireOrgOwner() is the
// UX gate; every RPC below re-checks is_org_owner() and refuses owner
// rows and the caller's own row.

export async function inviteMember(
  orgId: string,
  email: string,
  role: AssignableRole
): Promise<InviteResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("invite_member", {
    target_org_id: orgId,
    invitee_email: email.trim(),
    invitee_role: role,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  const delivery = await deliverInvite(email.trim().toLowerCase());
  revalidatePath(`/org/${orgId}/team`);
  return { ok: true, ...delivery };
}

/** Fresh link + email for an invite that's still pending (links expire). */
export async function resendOrgInvite(orgId: string, email: string): Promise<InviteResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  // Only for an unaccepted invite in THIS org — never an arbitrary email.
  const { data: invites, error } = await supabase.rpc("list_org_pending_invites", { target_org_id: orgId });
  if (error) return { ok: false, error: error.message };
  const match = (invites ?? []).some(
    (i: { email: string }) => i.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (!match) return { ok: false, error: "No pending invite for that email." };

  return { ok: true, ...(await deliverInvite(email.trim().toLowerCase())) };
}

export async function toggleOrgMemberSeatActive(
  orgId: string,
  userId: string,
  active: boolean
): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_org_member_seat_active", {
    target_org_id: orgId,
    target_user_id: userId,
    active,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}

export async function changeOrgMemberRole(
  orgId: string,
  userId: string,
  newRole: AssignableRole
): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_org_member_role", {
    target_org_id: orgId,
    target_user_id: userId,
    new_role: newRole,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}

export async function revokeOrgInvite(orgId: string, inviteId: string): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("revoke_org_invite", {
    target_invite_id: inviteId,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}

/**
 * Owner changes an admin's or user's sign-in email. The owner's own
 * email (and any owner's) can only be changed from platform admin.
 */
export async function changeOrgMemberEmail(
  orgId: string,
  userId: string,
  newEmail: string
): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  // Same guard as role/seat changes: caller owns the org, target is
  // another member and not an owner. Runs as the caller, so it can't
  // be skipped by the service-role update below.
  const { error: guardError } = await supabase.rpc("assert_owner_can_manage_member", {
    target_org_id: orgId,
    target_user_id: userId,
  });
  if (guardError) return { ok: false, error: guardError.message };

  const result = await changeUserEmail(userId, newEmail);
  if (!result.ok) return result;

  await supabase.rpc("log_member_email_changed", {
    target_org_id: orgId,
    target_user_id: userId,
    new_email: result.email,
  });

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}

/**
 * Lets a user create/edit products and edit brand details. The one
 * team setting an admin can change too (owner or admin, never their own
 * row, users only), per set_member_brand_content_access().
 */
export async function setMemberBrandContentAccess(
  orgId: string,
  userId: string,
  allowed: boolean
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_member_brand_content_access", {
    target_org_id: orgId,
    target_user_id: userId,
    allowed,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}
