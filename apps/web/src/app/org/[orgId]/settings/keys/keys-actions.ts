"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";
import { verifyProviderKey } from "./verify-provider-key";
import type { ApiKeyProvider } from "./keys-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Verify-before-save, per spec §5.1. The raw key value passes through
 * this Server Action only — it is never logged, never returned to the
 * client, and never stored anywhere but Supabase Vault (via
 * save_org_secret's vault.create_secret/update_secret). A rejected key
 * is never saved at all, matching M2's own "Done when" criterion: "A
 * bad [key] is rejected on save, and the key never appears in any
 * response, log or Realtime payload."
 */
export async function saveProviderKey(
  orgId: string,
  provider: ApiKeyProvider,
  key: string
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);

  const trimmed = key.trim();
  if (trimmed.length < 4) {
    return { ok: false, error: "That doesn't look like a valid key." };
  }

  const verification = await verifyProviderKey(provider, trimmed);
  if (!verification.ok) {
    return { ok: false, error: verification.error };
  }

  const supabase = await createClient();

  const { error: saveError } = await supabase.rpc("save_org_secret", {
    target_org_id: orgId,
    target_provider: provider,
    secret_value: trimmed,
  });
  if (saveError) return { ok: false, error: saveError.message };

  const { error: verifyError } = await supabase.rpc("mark_org_secret_verified", {
    target_org_id: orgId,
    target_provider: provider,
  });
  if (verifyError) return { ok: false, error: verifyError.message };

  revalidatePath(`/org/${orgId}/settings/keys`);
  return { ok: true };
}
