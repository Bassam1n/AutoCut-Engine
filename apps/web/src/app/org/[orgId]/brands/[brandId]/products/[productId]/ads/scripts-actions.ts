"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd } from "@/lib/access";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { AdScriptsSchema } from "@/lib/claude/schemas/ad-scripts";
import { getBrand } from "@/app/org/[orgId]/brands/brands-data";
import { getProduct } from "../../products-data";
import { getCustomers } from "@/app/org/[orgId]/brands/[brandId]/customers/customers-data";
import { getCategoryToneNotes } from "./scripts-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Generates exactly 3 script variations for an ad, given a target
 * length the editor must provide first. Pulls brand context, the
 * product's facts and category tone brief, and all of the brand's
 * customer profiles as context — spec decision from the user: the
 * editor already filled these in elsewhere, so script generation
 * should use them automatically rather than asking again.
 */
export async function generateScripts(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  targetLengthSeconds: number
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  if (!Number.isFinite(targetLengthSeconds) || targetLengthSeconds <= 0) {
    return { ok: false, error: "Ad length must be a positive number of seconds." };
  }

  const [brand, product, customers] = await Promise.all([
    getBrand(orgId, brandId),
    getProduct(orgId, brandId, productId),
    getCustomers(orgId, brandId),
  ]);

  if (!brand || !product) {
    return { ok: false, error: "Brand or product not found." };
  }
  // The ad_scripts rewrite below uses the service role, keyed by adId.
  if (!(await getAccessibleAd(orgId, adId, brandId))) {
    return { ok: false, error: "Ad not found." };
  }

  const toneNotes = await getCategoryToneNotes(product.category);

  let output;
  try {
    const result = await llmCall({
      task: "generate_ad_scripts",
      schema: AdScriptsSchema,
      orgId,
      input: {
        target_length_seconds: targetLengthSeconds,
        brand_context: brand.brand_context,
        product: {
          name: product.name,
          category: product.category,
          what_it_is: product.what_it_is,
        },
        category_tone_notes: toneNotes,
        customer_profiles: customers.map((c) => c.profile),
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const supabase = await createClient();

  const { error: lengthError } = await supabase
    .from("ads")
    .update({ target_length_seconds: targetLengthSeconds })
    .eq("org_id", orgId)
    .eq("id", adId);
  if (lengthError) return { ok: false, error: lengthError.message };

  // Service client: script rows should atomically replace any prior
  // attempt's rows, which means deleting first — a regenerate re-runs
  // this whole action, so stale variants from a previous call must
  // not linger alongside the new 3.
  const service = createServiceClient();
  const { error: deleteError } = await service
    .from("ad_scripts")
    .delete()
    .eq("org_id", orgId)
    .eq("ad_id", adId);
  if (deleteError) return { ok: false, error: deleteError.message };

  const rows = output.scripts.map((script, i) => ({
    org_id: orgId,
    ad_id: adId,
    variant_index: i + 1,
    hook: script.hook,
    body: script.body,
    cta: script.cta,
  }));

  const { error: insertError } = await service.from("ad_scripts").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function selectScript(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  scriptId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("ad_scripts")
    .update({ selected: false })
    .eq("org_id", orgId)
    .eq("ad_id", adId);
  if (clearError) return { ok: false, error: clearError.message };

  const { error: selectError } = await supabase
    .from("ad_scripts")
    .update({ selected: true })
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", scriptId);
  if (selectError) return { ok: false, error: selectError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
