import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrgSecrets } from "../settings/keys/keys-data";

export type SetupChecklist = {
  anthropicKeyVerified: boolean;
  imageProviderKeyVerified: boolean;
  brandWithProduct: boolean;
};

export function isChecklistComplete(checklist: SetupChecklist): boolean {
  return (
    checklist.anthropicKeyVerified &&
    checklist.imageProviderKeyVerified &&
    checklist.brandWithProduct
  );
}

/**
 * Spec §5.1: "A required setup checklist before generation: Anthropic
 * key verified, at least one image provider key, at least one brand
 * with a product." Read-only — this doesn't block navigation anywhere
 * yet (nothing to generate until M3+), it's surfaced so an org knows
 * what's left before they'll be able to generate once that exists.
 */
export async function getSetupChecklist(orgId: string): Promise<SetupChecklist> {
  const supabase = await createClient();

  const [secrets, brandsResult] = await Promise.all([
    getOrgSecrets(orgId),
    supabase.from("brands").select("id").eq("org_id", orgId).eq("active", true),
  ]);

  if (brandsResult.error) throw new Error(brandsResult.error.message);

  const anthropicKeyVerified = secrets.some(
    (s) => s.provider === "anthropic" && s.verified_at !== null
  );
  const imageProviderKeyVerified = secrets.some(
    (s) => (s.provider === "kie" || s.provider === "fal") && s.verified_at !== null
  );

  const brandIds = (brandsResult.data ?? []).map((b) => b.id);
  let brandWithProduct = false;

  if (brandIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("brand_id", brandIds)
      .limit(1);

    if (productsError) throw new Error(productsError.message);
    brandWithProduct = (products?.length ?? 0) > 0;
  }

  return { anthropicKeyVerified, imageProviderKeyVerified, brandWithProduct };
}
