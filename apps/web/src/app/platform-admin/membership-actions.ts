"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { changeUserEmail } from "@/lib/change-email";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function toggleSeatActive(
  orgId: string,
  userId: string,
  active: boolean
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_member_seat_active", {
    target_org_id: orgId,
    target_user_id: userId,
    active,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin");
  return { ok: true };
}

export async function changeRole(
  orgId: string,
  userId: string,
  newRole: "owner" | "admin" | "editor"
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_member_role", {
    target_org_id: orgId,
    target_user_id: userId,
    new_role: newRole,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin");
  return { ok: true };
}

export async function setOrgSeatCap(
  orgId: string,
  seatCap: number | null
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_org_seat_cap", {
    target_org_id: orgId,
    new_seat_cap: seatCap,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin");
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { error } = await supabase.rpc("revoke_pending_invite", {
    target_invite_id: inviteId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin");
  return { ok: true };
}

/**
 * Platform admin changes any member's sign-in email, including an
 * owner's (owners can't change their own; org owners can only change
 * admins' and users').
 */
export async function changeMemberEmail(
  orgId: string,
  userId: string,
  newEmail: string
): Promise<ActionResult> {
  await requirePlatformAdmin();

  const result = await changeUserEmail(userId, newEmail);
  if (!result.ok) return result;

  const supabase = await createClient();
  await supabase.rpc("log_member_email_changed", {
    target_org_id: orgId,
    target_user_id: userId,
    new_email: result.email,
  });

  revalidatePath("/platform-admin");
  return { ok: true };
}

/**
 * Ad creation access for one member: true/false, or null to fall back
 * to the role default (users yes, owners and admins no).
 */
export async function setMemberAdAccess(
  orgId: string,
  userId: string,
  allowed: boolean | null
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_member_can_create_ads", {
    target_org_id: orgId,
    target_user_id: userId,
    allowed,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin");
  return { ok: true };
}
