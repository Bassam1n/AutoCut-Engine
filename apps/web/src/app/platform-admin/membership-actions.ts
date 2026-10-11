"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth";

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
