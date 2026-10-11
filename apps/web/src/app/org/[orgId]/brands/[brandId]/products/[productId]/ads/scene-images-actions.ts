"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { WriteImagePromptSchema } from "@/lib/claude/schemas/write-image-prompt";
import { GenerateProductSpecSchema } from "@/lib/claude/schemas/generate-product-spec";
import { generateReferenceImage } from "@/lib/providers/generate-reference-image";
import { getAd } from "./ads-data";
import { getScenes, type Scene } from "./scenes-data";
import { getCastMembers } from "./concepts-data";
import { getActiveRulesForAd, getLatestProductSpec } from "./scene-images-data";
import { getBrand } from "@/app/org/[orgId]/brands/brands-data";
import { getProduct, getProductRefs, getProductRefSignedUrls } from "../../products-data";
import type { ProductRef } from "../../products-data";

// Scene-image generation polls a provider synchronously (no async job
// runner yet — M9) and can take well over Vercel's default function
// timeout, especially with several scenes generating concurrently via
// Generate All's stagger. The matching `maxDuration` route config
// lives on the ad Studio page.tsx (a "use server" actions file can
// only export async functions, not a route-segment config const) —
// see generate-reference-image.ts's MAX_ATTEMPTS for the matching
// poll-loop cap.

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ModelChoice = { provider: "fal" | "kie"; endpoint: string };

/**
 * Reference-image assembly cap for the actual image-generation call
 * (spec §5.6: "trimmed to the model's limit"). No documented hard
 * limit is confirmed for any model in the registry, so this is a
 * sane, explicitly-not-authoritative default rather than a number
 * read from real provider docs — revisit per-model once the registry
 * tracks a real max_reference_images field.
 */
const REFERENCE_IMAGE_CAP = 4;

export type ReferenceTierLabel =
  | "product photo"
  | "feedback image"
  | "character reference"
  | "angle photo";

export type AssembledReferences = {
  urls: string[];
  /** What was trimmed off the end when the full set exceeded REFERENCE_IMAGE_CAP, grouped by tier for the UI note (spec: "show a note naming what"). */
  omitted: { tier: ReferenceTierLabel; count: number }[];
};

/**
 * Spec §5.6 reference-assembly priority order:
 *   a. product main photo (kind='photo'), only when scene.product_id is set
 *   b. attached feedback images for this scene (assets.kind='feedback')
 *   c. character references: ref_asset_id of every APPROVED cast member on this ad
 *   d. place/style references — NOT MODELED in the schema yet (no asset kind
 *      exists for this), so this tier is skipped entirely rather than
 *      inventing one.
 *   e. angle photos (product_refs kind='angle')
 * Trimmed to REFERENCE_IMAGE_CAP, dropping lowest-priority items first.
 */
export async function assembleSceneReferences(
  orgId: string,
  brandId: string,
  scene: Scene
): Promise<AssembledReferences> {
  const supabase = await createClient();
  const service = createServiceClient();

  type Tiered = { tier: ReferenceTierLabel; url: string };
  const tiers: Tiered[][] = [];

  // (a) product main photo — only when this scene has product in frame.
  if (scene.product_id) {
    const { data: photoRefs } = await supabase
      .from("product_refs")
      .select("*")
      .eq("org_id", orgId)
      .eq("product_id", scene.product_id)
      .eq("kind", "photo")
      .order("created_at", { ascending: true })
      .limit(1);
    const photoUrls = await signProductRefs(orgId, (photoRefs ?? []) as ProductRef[]);
    tiers.push(photoUrls.map((url) => ({ tier: "product photo" as const, url })));
  } else {
    tiers.push([]);
  }

  // (b) attached feedback images for this scene.
  const { data: feedbackAssets } = await supabase
    .from("assets")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("scene_id", scene.id)
    .eq("kind", "feedback")
    .eq("archived", false)
    .order("created_at", { ascending: true });
  const feedbackPaths = (feedbackAssets ?? []).map((a) => a.storage_path);
  const feedbackUrls = feedbackPaths.length
    ? await signRenderPaths(service, feedbackPaths)
    : [];
  tiers.push(feedbackUrls.map((url) => ({ tier: "feedback image" as const, url })));

  // (c) character references: every APPROVED cast member on this ad —
  // no per-scene cast assignment exists in the schema, so this is a
  // simple "include all approved cast for the ad" heuristic rather
  // than trying to infer which characters appear in this scene.
  const castMembers = await getCastMembers(orgId, scene.ad_id);
  const approvedRefAssetIds = castMembers.filter((c) => c.approved && c.ref_asset_id).map((c) => c.ref_asset_id as string);
  let castUrls: string[] = [];
  if (approvedRefAssetIds.length > 0) {
    const { data: castAssets } = await service
      .from("assets")
      .select("storage_path")
      .in("id", approvedRefAssetIds);
    const castPaths = (castAssets ?? []).map((a) => a.storage_path);
    castUrls = await signRenderPaths(service, castPaths);
  }
  tiers.push(castUrls.map((url) => ({ tier: "character reference" as const, url })));

  // (d) place/style references — spec §5.6 names this tier, but no
  // asset kind or table models "place or style reference" images yet
  // (only product_refs, cast ref/sheet assets, and now feedback
  // assets exist). Intentionally skipped rather than inventing a kind
  // — revisit once that's modeled.

  // (e) angle photos (product_refs kind='angle') — lowest priority.
  let angleUrls: string[] = [];
  if (scene.product_id) {
    const { data: angleRefs } = await supabase
      .from("product_refs")
      .select("*")
      .eq("org_id", orgId)
      .eq("product_id", scene.product_id)
      .eq("kind", "angle")
      .order("created_at", { ascending: true });
    angleUrls = await signProductRefs(orgId, (angleRefs ?? []) as ProductRef[]);
  }
  tiers.push(angleUrls.map((url) => ({ tier: "angle photo" as const, url })));

  const flat = tiers.flat();
  const kept = flat.slice(0, REFERENCE_IMAGE_CAP);
  const dropped = flat.slice(REFERENCE_IMAGE_CAP);

  const omittedByTier = new Map<ReferenceTierLabel, number>();
  for (const item of dropped) {
    omittedByTier.set(item.tier, (omittedByTier.get(item.tier) ?? 0) + 1);
  }

  void brandId; // reserved for a future brand-scoped reference tier; unused for now
  return {
    urls: kept.map((k) => k.url),
    omitted: Array.from(omittedByTier.entries()).map(([tier, count]) => ({ tier, count })),
  };
}

async function signProductRefs(orgId: string, refs: ProductRef[]): Promise<string[]> {
  if (refs.length === 0) return [];
  const signedByPath = await getProductRefSignedUrls(orgId, refs);
  return refs.map((r) => signedByPath[r.storage_path]).filter((u): u is string => Boolean(u));
}

async function signRenderPaths(
  service: ReturnType<typeof createServiceClient>,
  paths: string[]
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await service.storage.from("renders").createSignedUrls(paths, 3600);
  if (error) return [];
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
}

/**
 * Lazily generates and stores the first product_specs row for a
 * product, the first time scene-image generation needs one and none
 * exists yet. Never triggered from the product photo upload flow —
 * only from here. Uses the product's main photo tier first (kind=
 * 'photo'), falling back to every available ref if no main photo is
 * saved, since a vision call with zero images would be pointless.
 */
async function ensureProductSpec(orgId: string, productId: string): Promise<void> {
  const existing = await getLatestProductSpec(orgId, productId);
  if (existing) return;

  const refs = await getProductRefs(orgId, productId);
  if (refs.length === 0) return; // nothing to look at yet — leave unspecced until photos exist

  const preferred = refs.filter((r) => r.kind === "photo");
  const toUse = preferred.length > 0 ? preferred : refs;
  const signedByPath = await getProductRefSignedUrls(orgId, toUse);
  const imageUrls = toUse.map((r) => signedByPath[r.storage_path]).filter((u): u is string => Boolean(u));
  if (imageUrls.length === 0) return;

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("name, category, what_it_is")
    .eq("org_id", orgId)
    .eq("id", productId)
    .maybeSingle();

  let output;
  try {
    const result = await llmCall({
      task: "generate_product_spec",
      schema: GenerateProductSpecSchema,
      orgId,
      imageUrls,
      input: {
        known_product_facts: product ?? null,
      },
    });
    output = result.output;
  } catch (err) {
    // A failed spec generation shouldn't block scene-image generation —
    // the prompt writer just runs without a spec this time, same as
    // any product that never gets one.
    if (err instanceof LlmCallError) return;
    throw err;
  }

  const { data: latest } = await supabase
    .from("product_specs")
    .select("version")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  await supabase.from("product_specs").insert({
    org_id: orgId,
    product_id: productId,
    version: nextVersion,
    spec: output,
    source: "vision",
    approved: false,
  });
}

/**
 * Resolves the final image prompt for a scene — spec §5.6: "The
 * editor can open the exact final prompt and save a sticky override."
 * If image_prompt_override is set, that text IS the final prompt
 * word-for-word and the write_image_prompt Claude call is skipped
 * entirely. Otherwise runs write_image_prompt over the scene's
 * Visual/copy, brand/product context, style masterprompt, active
 * rules and (if one exists) the product spec.
 */
export async function resolveFinalImagePrompt(
  orgId: string,
  brandId: string,
  productId: string,
  scene: Scene
): Promise<{ ok: true; prompt: string; wasOverride: boolean } | { ok: false; error: string }> {
  if (scene.image_prompt_override) {
    return { ok: true, prompt: scene.image_prompt_override, wasOverride: true };
  }

  const supabase = await createClient();
  const ad = await getAd(orgId, productId, scene.ad_id);
  if (!ad) return { ok: false, error: "Ad not found." };

  const [brand, product] = await Promise.all([
    getBrand(orgId, brandId),
    getProduct(orgId, brandId, productId),
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

  if (scene.product_id) {
    await ensureProductSpec(orgId, scene.product_id);
  }
  const productSpec = scene.product_id ? await getLatestProductSpec(orgId, scene.product_id) : null;

  const rules = await getActiveRulesForAd(orgId, brandId, ad.style_id, scene.product_id);

  try {
    const result = await llmCall({
      task: "write_image_prompt",
      schema: WriteImagePromptSchema,
      orgId,
      input: {
        visual: scene.visual,
        copy: scene.copy,
        brand_context: brand.brand_context,
        product: { name: product.name, category: product.category, what_it_is: product.what_it_is },
        style_masterprompt: styleMasterprompt,
        active_rules: rules.map((r) => ({ kind: r.kind, text: r.text })),
        product_spec: productSpec?.spec ?? null,
      },
    });
    return { ok: true, prompt: result.output.final_prompt, wasOverride: false };
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }
}

export type GenerateSceneImagesResult =
  | { ok: true; generatedCount: number; omitted: { tier: ReferenceTierLabel; count: number }[] }
  | { ok: false; error: string };

/**
 * Generates `count` images for one scene (1-4, editor-chosen at
 * generate time — spec §5.6). Follows generate-reference-image.ts's
 * synchronous inline submit-then-poll pattern exactly, one call per
 * requested image, scene-scoped and versioned.
 *
 * Automatic refill (spec §5.6): if fewer images come back than
 * requested (a provider that only returns 1 regardless of the
 * requested count, or a partial failure), the shortfall is
 * automatically re-requested, up to 2 extra rounds total.
 */
export async function generateSceneImages(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  count: number,
  model: ModelChoice
): Promise<GenerateSceneImagesResult> {
  await requireOrgMember(orgId);

  const clampedCount = Math.max(1, Math.min(4, Math.trunc(count)));

  const scenes = await getScenes(orgId, adId);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene not found." };

  const promptResult = await resolveFinalImagePrompt(orgId, brandId, productId, scene);
  if (!promptResult.ok) return { ok: false, error: promptResult.error };

  const references = await assembleSceneReferences(orgId, brandId, scene);

  const service = createServiceClient();
  const { data: existingVersions } = await service
    .from("assets")
    .select("version")
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "image")
    .order("version", { ascending: false })
    .limit(1);
  let nextVersion = (existingVersions?.[0]?.version ?? 0) + 1;

  let remaining = clampedCount;
  let generated = 0;
  let lastError: string | null = null;

  // Up to 3 total rounds: the initial request plus 2 refill rounds
  // (spec §5.6: "up to 2 extra rounds"), same bounded-retry shape as
  // generate-reference-image.ts's own poll loop.
  for (let round = 0; round < 3 && remaining > 0; round++) {
    const requestsThisRound = remaining;
    for (let i = 0; i < requestsThisRound; i++) {
      const imageResult = await generateReferenceImage({
        orgId,
        brandId,
        prompt: promptResult.prompt,
        referenceImageUrls: references.urls.length > 0 ? references.urls : undefined,
        provider: model.provider,
        endpoint: model.endpoint,
        attributedAdId: adId,
        spendKind: "image:scene_image",
      });

      if (!imageResult.ok) {
        lastError = imageResult.error;
        continue;
      }

      // generateReferenceImage() always inserts brand-scoped
      // (ad_id: null, brand_id: set) — assets_ad_or_brand_check
      // (migration 36) requires exactly one of the two to be set, so
      // brand_id must be cleared here in the same update that sets
      // ad_id, not just ad_id set on its own.
      const { error: updateError } = await service
        .from("assets")
        .update({ ad_id: adId, brand_id: null, scene_id: sceneId, version: nextVersion })
        .eq("id", imageResult.assetId);
      if (updateError) {
        lastError = updateError.message;
        continue;
      }

      nextVersion += 1;
      generated += 1;
      remaining -= 1;
    }
  }

  if (generated === 0) {
    return { ok: false, error: lastError ?? "Image generation failed." };
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true, generatedCount: generated, omitted: references.omitted };
}

/** Scenes eligible for "Generate All" — spec §5.6: skips scenes that already have (non-archived) images. In-flight/generating scenes are tracked client-side, not here. */
export async function getScenesWithoutImages(orgId: string, adId: string): Promise<string[]> {
  const scenes = await getScenes(orgId, adId);
  const service = createServiceClient();
  const { data: existing } = await service
    .from("assets")
    .select("scene_id")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "image")
    .eq("archived", false);
  const sceneIdsWithImages = new Set((existing ?? []).map((a) => a.scene_id));
  return scenes.filter((s) => !sceneIdsWithImages.has(s.id)).map((s) => s.id);
}

/** Save/reset the sticky prompt override (spec §5.6: "Reset removes it"). */
export async function saveImagePromptOverride(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  override: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ image_prompt_override: override })
    .eq("org_id", orgId)
    .eq("id", sceneId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Reserves a storage path for a scene-scoped feedback image upload —
 * same direct-to-Storage pattern as reserveProductRefPath/
 * reserveCastReferenceUploadPath, never through a Next.js route.
 */
export async function reserveFeedbackImageUploadPath(
  orgId: string,
  adId: string,
  sceneId: string,
  fileName: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  await requireOrgMember(orgId);

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/feedback/${adId}/${sceneId}/${Date.now()}_${safeName}`;

  return { ok: true, path };
}

/** Records a scene-scoped feedback image after the browser confirms the direct Storage upload succeeded. Spec §5.6 reference tier (b) / §5.8 "attach a reference image". */
export async function recordFeedbackImage(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  storagePath: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const service = createServiceClient();
  const { error } = await service.from("assets").insert({
    org_id: orgId,
    ad_id: adId,
    scene_id: sceneId,
    kind: "feedback",
    storage_path: storagePath,
    source: "editor_upload",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
