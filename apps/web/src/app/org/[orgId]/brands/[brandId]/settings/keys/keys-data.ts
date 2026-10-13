import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ApiKeyProvider } from "@/app/org/[orgId]/settings/keys/keys-data";

export type BrandSecretRow = {
  provider: ApiKeyProvider;
  last4: string;
  verified_at: string | null;
  created_at: string;
};

export async function getBrandSecrets(orgId: string, brandId: string): Promise<BrandSecretRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_brand_secrets", {
    target_org_id: orgId,
    target_brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
