"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

const FRIENDLY_ERRORS: Record<string, string> = {
  seat_cap_not_configured:
    "Your seat limit hasn't been set yet. Ask the platform admin to configure it.",
  seat_cap_reached:
    "You've reached your team's seat limit. Deactivate a seat or ask the platform admin to raise the limit.",
};

function friendlyError(message: string): string {
  return FRIENDLY_ERRORS[message] ?? message;
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: "owner" | "admin" | "editor"
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
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
  await requireOrgAdmin(orgId);
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
  newRole: "owner" | "admin" | "editor"
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
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
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("revoke_org_invite", {
    target_invite_id: inviteId,
  });

  if (error) return { ok: false, error: friendlyError(error.message) };

  revalidatePath(`/org/${orgId}/team`);
  return { ok: true };
}
