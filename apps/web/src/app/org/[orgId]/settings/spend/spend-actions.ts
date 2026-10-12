"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resume a paused org. Spec §5.10: "Only an owner or admin can
 * resume, and resuming is logged." requireOrgAdmin() is the UX-layer
 * gate (same pattern as every other admin-only Server Action in this
 * codebase — team-actions.ts, keys-actions.ts); resume_org()'s own
 * is_org_admin() check inside the RPC is the real boundary, so a
 * non-admin who somehow bypassed this layer would still be rejected
 * by Postgres.
 */
export async function resumeOrg(orgId: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("resume_org", {
    target_org_id: orgId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/settings/spend`);
  return { ok: true };
}
