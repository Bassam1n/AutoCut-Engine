"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd } from "@/lib/access";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { SceneImageChatSchema } from "@/lib/claude/schemas/scene-image-chat";
import { getEffectiveSceneStyle } from "@/lib/scene-style";
import { getBrand } from "@/app/org/[orgId]/brands/brands-data";
import { getProduct } from "../../products-data";
import { getAd } from "./ads-data";
import { getScenes } from "./scenes-data";
import { resolveFinalImagePrompt } from "./scene-images-actions";

export type SceneImageChatResult =
  | { ok: true; sceneId: string; sceneNumber: number; summary: string; prompt: string }
  | { ok: false; error: string };

/**
 * Scene images chat: "scene 3 is the CTA, write a prompt for it".
 * 1) plan_scene_image_from_chat picks the scene and writes its new
 *    visual in that scene's own style;
 * 2) the normal write_image_prompt step turns that visual into the
 *    final prompt (style masterprompt, product spec, rules apply);
 * 3) the visual is saved to the scene and the prompt becomes the
 *    scene's sticky override, so the editor sees it, can edit it, and
 *    presses Regenerate. Nothing is generated here.
 */
export async function chatSceneImagePrompt(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  message: string
): Promise<SceneImageChatResult> {
  await requireOrgMember(orgId);
  if (!message.trim()) return { ok: false, error: "Say what you want a scene to show." };
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const [ad, scenes, brand, product, concept] = await Promise.all([
    getAd(orgId, productId, adId),
    getScenes(orgId, adId),
    getBrand(orgId, brandId),
    getProduct(orgId, brandId, productId),
    supabase.from("concepts").select("options, selected_idx").eq("org_id", orgId).eq("ad_id", adId).maybeSingle(),
  ]);
  if (!ad) return { ok: false, error: "Ad not found." };
  if (scenes.length === 0) return { ok: false, error: "This ad has no scenes yet." };

  const styles = await Promise.all(scenes.map((s) => getEffectiveSceneStyle(supabase, ad.style_id, s.style_id)));
  const selectedConcept =
    concept.data && concept.data.selected_idx !== null ? (concept.data.options as unknown[])[concept.data.selected_idx] : null;

  let plan;
  try {
    const result = await llmCall({
      task: "plan_scene_image_from_chat",
      schema: SceneImageChatSchema,
      orgId,
      brandId,
      input: {
        request: message.trim().slice(0, 2000),
        brand: brand ? { name: brand.name, context: brand.brand_context } : null,
        product: product ? { name: product.name, what_it_is: product.what_it_is } : null,
        concept: selectedConcept,
        scenes: scenes.map((s, i) => ({
          idx: s.idx,
          scene_number: s.idx + 1,
          hook_group: s.hook_group,
          copy: s.copy,
          current_visual: s.visual,
          product_in_frame: s.product_id !== null,
          style: { name: styles[i].name, masterprompt: styles[i].masterprompt },
        })),
      },
    });
    plan = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const target = scenes.find((s) => s.idx === plan.scene_idx);
  if (!target) {
    return { ok: false, error: "Which scene do you mean? Name it, e.g. \"scene 3 is the CTA\"." };
  }

  // Write the final prompt from the new visual with the normal pipeline
  // (an override would short-circuit it, so pass the scene without one).
  const promptResult = await resolveFinalImagePrompt(orgId, brandId, productId, {
    ...target,
    visual: plan.visual,
    image_prompt_override: null,
  });
  if (!promptResult.ok) return { ok: false, error: promptResult.error };

  const { error } = await supabase
    .from("scenes")
    .update({ visual: plan.visual, image_prompt_override: promptResult.prompt })
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", target.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return {
    ok: true,
    sceneId: target.id,
    sceneNumber: target.idx + 1,
    summary: plan.summary,
    prompt: promptResult.prompt,
  };
}
