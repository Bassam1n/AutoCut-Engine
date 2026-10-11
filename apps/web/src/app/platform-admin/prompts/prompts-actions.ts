"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { getPromptHistory, type PromptVersionRow } from "./prompts-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function savePromptVersion(task: string, body: string): Promise<ActionResult> {
  await requirePlatformAdmin();

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Prompt body cannot be empty." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_prompt_version", {
    target_task: task,
    new_body: trimmed,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/platform-admin/prompts");
  return { ok: true };
}

export async function fetchPromptHistory(task: string): Promise<PromptVersionRow[]> {
  await requirePlatformAdmin();
  return getPromptHistory(task);
}
