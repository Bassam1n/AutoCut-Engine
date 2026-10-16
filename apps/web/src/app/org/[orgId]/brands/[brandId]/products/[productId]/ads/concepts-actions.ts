"use server";

import { storageFullError } from "@/lib/storage-quota";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { ConceptsSchema, type ConceptOption } from "@/lib/claude/schemas/concepts";
import { CastExtractionSchema } from "@/lib/claude/schemas/cast-extraction";
import { generateReferenceImage } from "@/lib/providers/generate-reference-image";
import { getAd } from "./ads-data";
import { getScenes } from "./scenes-data";
import { getBrand } from "@/app/org/[orgId]/brands/brands-data";
import { getProduct } from "../../products-data";
import { getCustomers } from "@/app/org/[orgId]/brands/[brandId]/customers/customers-data";
import { getBrandCastMembers } from "./concepts-data";
import { getAccessibleAd, isPathUnder } from "@/lib/access";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type ModelChoice = { provider: "fal" | "kie"; endpoint: string };

const DEFAULT_IMAGE_MODEL: ModelChoice = { provider: "fal", endpoint: "fal-ai/flux/dev" };

export async function generateConcepts(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };
  if (!ad.plan_locked) return { ok: false, error: "Lock the scene plan before generating concepts." };

  const scenes = await getScenes(orgId, adId);
  if (scenes.length === 0) return { ok: false, error: "No scenes found." };

  const [brand, product, customers] = await Promise.all([
    getBrand(orgId, brandId),
    getProduct(orgId, brandId, productId),
    getCustomers(orgId, brandId),
  ]);
  if (!brand || !product) return { ok: false, error: "Brand or product not found." };

  let styleMasterprompt: string | null = null;
  if (ad.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("masterprompt")
      .eq("id", ad.style_id)
      .maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  let output;
  try {
    const result = await llmCall({
      task: "generate_concepts",
      schema: ConceptsSchema,
      orgId,
      input: {
        scenes: scenes.map((s) => ({ idx: s.idx, hook_group: s.hook_group, copy: s.copy })),
        brand_context: brand.brand_context,
        product: { name: product.name, category: product.category, what_it_is: product.what_it_is },
        customer_profiles: customers.map((c) => c.profile),
        style_masterprompt: styleMasterprompt,
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const { error } = await supabase
    .from("concepts")
    .upsert({ ad_id: adId, org_id: orgId, options: output.concepts, selected_idx: null }, { onConflict: "ad_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Lets an editor who already has their own creative direction skip
 * generation entirely (friction-audit finding: some agencies don't
 * want to wait for/pay for a 3-option Claude pitch when the concept
 * is already decided). Writes a one-option concepts row directly —
 * no llmCall, no spend tracking, since this isn't a paid generation
 * action — and auto-selects that option since there's nothing else
 * to choose between.
 */
export async function createManualConcept(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  option: ConceptOption
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("concepts")
    .upsert({ ad_id: adId, org_id: orgId, options: [option], selected_idx: 0 }, { onConflict: "ad_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function selectConcept(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  index: number
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("concepts")
    .update({ selected_idx: index })
    .eq("org_id", orgId)
    .eq("ad_id", adId);

  if (error) return { ok: false, error: error.message };

  // Switching concepts invalidates any cast already extracted for the
  // previous selection — clear it so the editor doesn't see stale
  // characters that belonged to a different concept.
  const { error: clearCastError } = await supabase
    .from("cast_members")
    .delete()
    .eq("org_id", orgId)
    .eq("ad_id", adId);
  if (clearCastError) return { ok: false, error: clearCastError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function editSelectedConcept(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  index: number,
  edited: ConceptOption
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { data: concept, error: fetchError } = await supabase
    .from("concepts")
    .select("options")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!concept) return { ok: false, error: "No concepts generated yet." };

  const options = [...(concept.options as ConceptOption[])];
  options[index] = edited;

  const { error } = await supabase
    .from("concepts")
    .update({ options })
    .eq("org_id", orgId)
    .eq("ad_id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Extracts the cast once a concept is accepted. Matches against the
 * brand's reusable cast library, creates cast_members rows (linked
 * to a brand_cast_member when matched), and generates a fresh
 * reference image for any genuinely new character — reusing the
 * brand cast member's existing reference image when matched, never
 * regenerating one that already exists and was approved.
 */
export async function extractCast(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  model: ModelChoice = DEFAULT_IMAGE_MODEL
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  // brandId picks the provider key and is stamped on new assets, so it
  // must be this ad's brand, and the ad one the caller can see.
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();

  const { data: concept, error: conceptError } = await supabase
    .from("concepts")
    .select("options, selected_idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .maybeSingle();
  if (conceptError) return { ok: false, error: conceptError.message };
  if (!concept || concept.selected_idx === null) {
    return { ok: false, error: "Select a concept before extracting cast." };
  }

  const selectedConcept = (concept.options as ConceptOption[])[concept.selected_idx];
  const scenes = await getScenes(orgId, adId);
  const brandCast = await getBrandCastMembers(orgId, brandId);

  const ad = await getAd(orgId, productId, adId);
  let styleMasterprompt: string | null = null;
  if (ad?.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("masterprompt")
      .eq("id", ad.style_id)
      .maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  let output;
  try {
    const result = await llmCall({
      task: "extract_cast",
      schema: CastExtractionSchema,
      orgId,
      input: {
        concept: selectedConcept,
        scenes: scenes.map((s) => ({ idx: s.idx, copy: s.copy })),
        existing_brand_cast: brandCast.map((c) => ({ id: c.id, name: c.name, description: c.description })),
        style_masterprompt: styleMasterprompt,
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  // Re-extraction (editor clicks "Re-extract cast" again for the same
  // ad/concept) must replace, not append — otherwise every re-run
  // duplicates the cast_members rows shown in the UI.
  const { error: deleteError } = await supabase.from("cast_members").delete().eq("org_id", orgId).eq("ad_id", adId);
  if (deleteError) return { ok: false, error: deleteError.message };

  const brandCastById = new Map(brandCast.map((c) => [c.id, c]));

  for (const character of output.characters) {
    const matched = character.matched_brand_cast_member_id
      ? brandCastById.get(character.matched_brand_cast_member_id)
      : null;

    if (matched) {
      const { error } = await supabase.from("cast_members").insert({
        org_id: orgId,
        ad_id: adId,
        name: matched.name,
        description: matched.description,
        ref_asset_id: matched.ref_asset_id,
        sheet_asset_id: matched.sheet_asset_id,
        brand_cast_member_id: matched.id,
        approved: true,
      });
      if (error) return { ok: false, error: error.message };
      continue;
    }

    const imageResult = await generateReferenceImage({
      orgId,
      brandId,
      prompt: buildCastReferencePrompt(character.description, styleMasterprompt),
      provider: model.provider,
      endpoint: model.endpoint,
      attributedAdId: adId,
      spendKind: "image:cast_reference",
    });

    const { data: newCastMember, error: insertError } = await supabase
      .from("cast_members")
      .insert({
        org_id: orgId,
        ad_id: adId,
        name: character.name,
        description: character.description,
        ref_asset_id: imageResult.ok ? imageResult.assetId : null,
        approved: false,
      })
      .select("id")
      .single();
    if (insertError) return { ok: false, error: insertError.message };

    const { error: brandInsertError } = await supabase.from("brand_cast_members").insert({
      org_id: orgId,
      brand_id: brandId,
      name: character.name,
      description: character.description,
      ref_asset_id: imageResult.ok ? imageResult.assetId : null,
    });
    if (brandInsertError) return { ok: false, error: brandInsertError.message };

    if (!imageResult.ok) {
      revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
      return { ok: false, error: `Cast extracted, but reference image generation failed for ${character.name}: ${imageResult.error}` };
    }

    void newCastMember;
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Small change: Claude redraws the reference image with the feedback
 * folded into the prompt (and the style masterprompt, same as initial
 * extraction). Big change: the editor uploads their own image
 * instead, skipping generation entirely — spec §5.4 step 4: "approve,
 * or upload their own."
 */
export async function regenerateCastReference(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  castMemberId: string,
  feedback: string,
  model: ModelChoice = DEFAULT_IMAGE_MODEL
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  // brandId picks the provider key and is stamped on new assets, so it
  // must be this ad's brand, and the ad one the caller can see.
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const ad = await getAd(orgId, productId, adId);

  const { data: castMember, error: fetchError } = await supabase
    .from("cast_members")
    .select("description")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", castMemberId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!castMember) return { ok: false, error: "Cast member not found." };

  let styleMasterprompt: string | null = null;
  if (ad?.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("masterprompt")
      .eq("id", ad.style_id)
      .maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  const imageResult = await generateReferenceImage({
    orgId,
    brandId,
    prompt: `${buildCastReferencePrompt(castMember.description, styleMasterprompt)} Revision requested: ${feedback}`,
    provider: model.provider,
    endpoint: model.endpoint,
    attributedAdId: adId,
    spendKind: "image:cast_reference_regenerate",
  });
  if (!imageResult.ok) return { ok: false, error: imageResult.error };

  const { error } = await supabase
    .from("cast_members")
    .update({ ref_asset_id: imageResult.assetId, approved: false })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Reserves a storage path for the editor to upload their own cast
 * reference image directly, the same browser-to-Storage-direct
 * pattern used for product refs (never through a Next.js route, per
 * spec §6's Vercel body-limit note) — this action only computes the
 * path server-side so the {org_id}/... prefix storage RLS checks
 * against is never client-controlled.
 */
export async function reserveCastReferenceUploadPath(
  orgId: string,
  brandId: string,
  fileName: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  await requireOrgMember(orgId);
  const storageFull = await storageFullError(orgId);
  if (storageFull) return { ok: false, error: storageFull };

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/brand_cast/${brandId}/${Date.now()}_${safeName}`;

  return { ok: true, path };
}

export async function recordUploadedCastReference(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  castMemberId: string,
  storagePath: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  // brandId picks the provider key and is stamped on new assets, so it
  // must be this ad's brand, and the ad one the caller can see.
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();

  // Checked through RLS before the service-role insert below.
  const { data: castMember } = await supabase
    .from("cast_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", castMemberId)
    .maybeSingle();
  if (!castMember) return { ok: false, error: "Cast member not found." };
  if (!isPathUnder(storagePath, `${orgId}/brand_cast/${brandId}/`)) {
    return { ok: false, error: "Invalid upload path." };
  }

  const service = createServiceClient();

  const { data: assetRow, error: assetError } = await service
    .from("assets")
    .insert({ org_id: orgId, brand_id: brandId, ad_id: null, kind: "image", storage_path: storagePath, source: "upload" })
    .select("id")
    .single();
  if (assetError) return { ok: false, error: assetError.message };

  const { error } = await supabase
    .from("cast_members")
    .update({ ref_asset_id: assetRow.id, approved: false })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

function buildCastReferencePrompt(description: string, styleMasterprompt: string | null): string {
  const styleGuidance = styleMasterprompt
    ? ` Render in the following visual style: ${styleMasterprompt}`
    : "";
  return `Reference character portrait on a plain neutral backdrop, face clearly visible, consistent for reuse across a video ad.${styleGuidance} ${description}`;
}

export async function generateCharacterSheet(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  castMemberId: string,
  model: ModelChoice = DEFAULT_IMAGE_MODEL
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  // brandId picks the provider key and is stamped on new assets, so it
  // must be this ad's brand, and the ad one the caller can see.
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const ad = await getAd(orgId, productId, adId);

  const { data: castMember, error: fetchError } = await supabase
    .from("cast_members")
    .select("description, ref_asset_id")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", castMemberId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!castMember) return { ok: false, error: "Cast member not found." };

  let styleMasterprompt: string | null = null;
  if (ad?.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("masterprompt")
      .eq("id", ad.style_id)
      .maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  const service = createServiceClient();
  let referenceUrls: string[] | undefined;
  if (castMember.ref_asset_id) {
    const { data: asset } = await service
      .from("assets")
      .select("storage_path")
      .eq("org_id", orgId)
      .eq("id", castMember.ref_asset_id)
      .maybeSingle();
    if (asset) {
      const { data: signed } = await service.storage
        .from("renders")
        .createSignedUrl(asset.storage_path, 3600);
      if (signed) referenceUrls = [signed.signedUrl];
    }
  }

  const styleGuidance = styleMasterprompt ? ` Render in the following visual style: ${styleMasterprompt}` : "";
  const imageResult = await generateReferenceImage({
    orgId,
    brandId,
    prompt: `Character reference sheet on a plain neutral backdrop: front view, side profile, and three expressions (neutral, smiling, speaking), all of the same person for visual consistency across a video ad.${styleGuidance} ${castMember.description}`,
    referenceImageUrls: referenceUrls,
    provider: model.provider,
    endpoint: model.endpoint,
    attributedAdId: adId,
    spendKind: "image:character_sheet",
  });
  if (!imageResult.ok) return { ok: false, error: `Character sheet generation failed: ${imageResult.error}` };

  const { error } = await supabase
    .from("cast_members")
    .update({ sheet_asset_id: imageResult.assetId })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function approveCastMember(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  castMemberId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("cast_members")
    .update({ approved: true })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Bulk variant of approveCastMember (friction-audit finding: approving
 * a 3-4 character cast one card at a time before "Generate storyboard"
 * unlocks was pure friction with no reason behind it). Approves every
 * not-yet-approved cast member for this ad in one update — scoped by
 * ad_id (not a list of ids) so it stays correct even if a card hasn't
 * synced client-side yet.
 */
export async function approveAllCastMembers(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("cast_members")
    .update({ approved: true })
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("approved", false);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
