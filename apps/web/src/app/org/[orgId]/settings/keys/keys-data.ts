import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ApiKeyProvider = "anthropic" | "kie" | "fal" | "higgsfield" | "elevenlabs" | "twelvelabs" | "pexels";
export type OAuthProvider = "xai" | "heygen";

export type OrgSecretRow = {
  provider: ApiKeyProvider;
  last4: string;
  verified_at: string | null;
  created_at: string;
};

export async function getOrgSecrets(orgId: string): Promise<OrgSecretRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_secrets", {
    target_org_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Which providers have a key saved for this org (or this brand, when
 * given). Provider names only, no last4/verified status, so it's safe
 * for every member: the ad studio uses it to warn about missing keys,
 * while the full key listing (list_org_secrets) is owner-only.
 */
export async function getProvidersWithKeys(orgId: string, brandId?: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_providers_with_keys", {
    target_org_id: orgId,
    target_brand_id: brandId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { provider: string }) => row.provider);
}
