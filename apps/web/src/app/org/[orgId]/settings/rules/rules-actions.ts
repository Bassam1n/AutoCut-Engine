"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Edit a rule's text/kind. Spec §5.8: "A rules screen lets admins
 * read, edit, pause and delete them." requireOrgAdmin() is the
 * UX-layer gate (same pattern as spend-actions.ts's resumeOrg) — the
 * real boundary is rules_admin_update's own is_org_admin() check
 * (migration 10), so a plain client-side update under that policy is
 * enough here; no RPC needed, unlike rule CREATION (which has no
 * insert policy at all and must go through the service-role-only
 * create_rule_from_feedback RPC the distillation job uses).
 */
export async function updateRule(
  orgId: string,
  ruleId: string,
  fields: { text?: string; kind?: "do" | "avoid" }
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("rules")
    .update(fields)
    .eq("id", ruleId)
    .eq("org_id", orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/settings/rules`);
  return { ok: true };
}

/** Pause (active = false) — reversible, matches "pause" in the spec sentence rather than deleting. */
export async function setRuleActive(orgId: string, ruleId: string, active: boolean): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("rules")
    .update({ active })
    .eq("id", ruleId)
    .eq("org_id", orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/settings/rules`);
  return { ok: true };
}

/**
 * Genuine delete. rules_admin_delete (migration 10) lets an admin
 * delete directly — confirmed by reading that policy — unlike
 * feedback_events, which has no delete policy at all (append-only).
 * Rules are allowed real deletion because spec names it explicitly
 * ("... and delete them"), unlike every other "archive, never
 * delete" convention in this app.
 */
export async function deleteRule(orgId: string, ruleId: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase.from("rules").delete().eq("id", ruleId).eq("org_id", orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/settings/rules`);
  return { ok: true };
}
