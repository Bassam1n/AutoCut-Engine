"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function toggleFavouriteStyle(
  orgId: string,
  styleId: string,
  favourite: boolean
): Promise<ActionResult> {
  const user = await requireOrgMember(orgId);
  const supabase = await createClient();

  if (favourite) {
    const { error } = await supabase
      .from("user_style_favourites")
      .insert({ user_id: user.id, style_id: styleId });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("user_style_favourites")
      .delete()
      .eq("user_id", user.id)
      .eq("style_id", styleId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/org/${orgId}/styles`);
  return { ok: true };
}
