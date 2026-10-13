"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgOwner } from "@/lib/auth";
import { changeUserEmail } from "@/lib/change-email";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("invite_member", {
    target_org_id: orgId,
    invitee_email: email,
    invitee_role: role,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
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
