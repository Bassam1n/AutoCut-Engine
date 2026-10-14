"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin, requireOrgOwner } from "@/lib/auth";
import { changeUserEmail } from "@/lib/change-email";
import { generateNewAccountInviteLink } from "@/lib/invite-link";
import { sendSignInEmail } from "@/lib/send-signin-email";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type InviteResult = { ok: true; emailed: boolean; emailError: string | null } | { ok: false; error: string };
export type ShareLinkResult = { ok: true; link: string } | { ok: false; userExists: boolean; error: string };

/** Fails quietly into emailed=false: the invite row exists either way. */
async function emailInvite(email: string) {
  const sent = await sendSignInEmail(email);
  return { emailed: sent.ok, emailError: sent.ok ? null : sent.error };
}

/** Owner may only act on an unaccepted invite in THIS org. */
async function hasPendingInvite(orgId: string, email: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_org_pending_invites", { target_org_id: orgId });
  return (data ?? []).some((i: { email: string }) => i.email.toLowerCase() === email);
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

  const delivery = await emailInvite(email.trim().toLowerCase());
  revalidatePath(`/org/${orgId}/team`);
  return { ok: true, ...delivery };
}

/** Re-sends the sign-in email for an invite that's still pending (links expire). */
export async function resendOrgInvite(orgId: string, email: string): Promise<InviteResult> {
  await requireOrgOwner(orgId);
  const normalized = email.trim().toLowerCase();
  if (!(await hasPendingInvite(orgId, normalized))) return { ok: false, error: "No pending invite for that email." };
  return { ok: true, ...(await emailInvite(normalized)) };
}

/**
 * A copyable link to send over WhatsApp instead of email. Supabase keeps
 * one live token per person, so this REPLACES whatever link was emailed
 * (the UI says so). New accounts only; see generateNewAccountInviteLink.
 */
export async function shareableInviteLink(orgId: string, email: string): Promise<ShareLinkResult> {
  await requireOrgOwner(orgId);
  const normalized = email.trim().toLowerCase();
  if (!(await hasPendingInvite(orgId, normalized))) {
    return { ok: false, userExists: false, error: "No pending invite for that email." };
  }
  return generateNewAccountInviteLink(normalized);
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
