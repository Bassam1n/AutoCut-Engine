"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Saves the signed-in user's own name, phone and photo. RLS on
 * profiles (profiles_insert_self / profiles_update_self) only allows a
 * row whose user_id is the caller, so this can't touch anyone else.
 * avatarPath is undefined when the photo wasn't changed.
 */
export async function saveProfile(
  orgId: string,
  input: { fullName: string; phone: string; avatarPath?: string | null }
): Promise<ActionResult> {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  if (fullName.length > 120) return { ok: false, error: "Name is too long." };
  if (phone.length > 40) return { ok: false, error: "Phone number is too long." };
  if (phone && !/^[+()\d\s.-]{5,40}$/.test(phone)) {
    return { ok: false, error: "Use digits, spaces and + ( ) - only for the phone number." };
  }
  if (input.avatarPath && !input.avatarPath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid photo." };
  }

  const row: { user_id: string; full_name: string | null; phone: string | null; avatar_path?: string | null } = {
    user_id: user.id,
    full_name: fullName || null,
    phone: phone || null,
  };
  if (input.avatarPath !== undefined) row.avatar_path = input.avatarPath;

  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}`, "layout");
  return { ok: true };
}
