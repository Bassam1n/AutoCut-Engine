"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgOwner } from "@/lib/auth";
import { postToSlack } from "@/lib/slack";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Saves (or, with an empty string, disconnects) the org's Slack incoming webhook. Owner only. */
export async function saveSlackWebhook(orgId: string, url: string): Promise<ActionResult> {
  await requireOrgOwner(orgId);
  const trimmed = url.trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_slack_webhook", { target_org_id: orgId, webhook_url: trimmed });
  if (error) return { ok: false, error: error.message };

  if (trimmed) {
    const test = await postToSlack(orgId, "AutoCut is connected. Review requests and results will post here.");
    if (!test.ok) return { ok: false, error: `Saved, but the test message failed: ${test.error}` };
  }

  revalidatePath(`/org/${orgId}/settings/keys`);
  return { ok: true };
}
