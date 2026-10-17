"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";
import { verifyProviderKey } from "@/app/org/[orgId]/settings/keys/verify-provider-key";
import type { ApiKeyProvider } from "@/app/org/[orgId]/settings/keys/keys-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Brand-scoped twin of saveProviderKey (org-level settings/keys). Same
 * verify-before-save contract: the raw key passes through this Server
 * Action only, never logged/returned/stored anywhere but Vault (via
 * save_brand_secret's vault.create_secret/update_secret).
 *
 * requireOrgAdmin, not a brand-level check — this app has no
 * brand-scoped role, only org_members' org-wide owner/admin, and a
 * brand always belongs to exactly one org (save_brand_secret's own RPC
 * re-verifies brand_id belongs to target_org_id server-side regardless).
 */
export async function saveBrandProviderKey(
  orgId: string,
  brandId: string,
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

  const { error: saveError } = await supabase.rpc("save_brand_secret", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: provider,
    secret_value: trimmed,
  });
  if (saveError) return { ok: false, error: saveError.message };

  const { error: verifyError } = await supabase.rpc("mark_brand_secret_verified", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: provider,
  });
  if (verifyError) return { ok: false, error: verifyError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/settings/keys`);
  return { ok: true };
}
