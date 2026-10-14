"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth";
import type { AccessRequest } from "../data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setRequestStatus(
  id: string,
  status: AccessRequest["status"]
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("access_requests").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/platform-admin/requests");
  return { ok: true };
}
