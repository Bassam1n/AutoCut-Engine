"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd, sceneBelongsToAd } from "@/lib/access";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { SuggestSceneStylesSchema } from "@/lib/claude/schemas/suggest-scene-styles";
import { getVisibleStyles } from "@/app/org/[orgId]/styles/styles-data";
import { getAd } from "./ads-data";
import { getScenes } from "./scenes-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sets (or clears, with null) one scene's own style. Mixed-style ads cut
 * between looks scene by scene (a UGC talking head, then a 3D anatomy
 * cutaway); null puts the scene back on the ad's style. Already-generated
 * images keep their look until the scene is regenerated.
 */
export async function setSceneStyle(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  styleId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };
  if (!(await sceneBelongsToAd(orgId, adId, sceneId))) return { ok: false, error: "Scene not found." };

  const supabase = await createClient();
  if (styleId) {
    // Built-in styles or this org's own; never another agency's.
    const { data: style } = await supabase
      .from("styles")
      .select("id, org_id, active")
      .eq("id", styleId)
      .maybeSingle();
    if (!style || !style.active || (style.org_id !== null && style.org_id !== orgId)) {
      return { ok: false, error: "That style isn't available." };
    }
  }

  const { error } = await supabase
    .from("scenes")
    .update({ style_id: styleId })
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", sceneId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export type StyleSuggestion = { sceneId: string; sceneNumber: number; styleId: string | null; reason: string };
export type SuggestResult = { ok: true; suggestions: StyleSuggestion[] } | { ok: false; error: string };

/**
 * Asks Claude for the best style per scene (suggest_scene_styles). Read
 * only: nothing is applied until the editor accepts, via
 * applySceneStyles. Every returned style id is re-checked against the
 * catalog this org can actually use.
 */
export async function suggestSceneStyles(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<SuggestResult> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const [ad, scenes, concept, catalog] = await Promise.all([
    getAd(orgId, productId, adId),
    getScenes(orgId, adId),
    supabase.from("concepts").select("options, selected_idx").eq("org_id", orgId).eq("ad_id", adId).maybeSingle(),
    getVisibleStyles(orgId),
  ]);
  if (!ad) return { ok: false, error: "Ad not found." };
  if (scenes.length === 0) return { ok: false, error: "This ad has no scenes yet." };

  const styles = catalog.filter((s) => s.active);
  const byId = new Map(styles.map((s) => [s.id, s]));
  const selectedConcept =
    concept.data && concept.data.selected_idx !== null
      ? (concept.data.options as unknown[])[concept.data.selected_idx]
      : null;

  let output;
  try {
    const result = await llmCall({
      task: "suggest_scene_styles",
      schema: SuggestSceneStylesSchema,
      orgId,
      brandId,
      input: {
        default_style: ad.style_id ? { id: ad.style_id, name: byId.get(ad.style_id)?.name ?? null } : null,
        concept: selectedConcept,
        scenes: scenes.map((s) => ({
          idx: s.idx,
          hook_group: s.hook_group,
          copy: s.copy,
          visual: s.visual,
          current_style: s.style_id ? byId.get(s.style_id)?.name ?? null : "default",
        })),
        catalog: styles.map((s) => ({ id: s.id, name: s.name, description: s.description, categories: s.categories })),
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const byIdx = new Map(scenes.map((s) => [s.idx, s]));
  const suggestions: StyleSuggestion[] = [];
  for (const s of output.suggestions) {
    const scene = byIdx.get(s.scene_idx);
    if (!scene) continue;
    // Drop invented ids; the ad's own style means "keep default".
    const styleId = s.style_id && byId.has(s.style_id) && s.style_id !== ad.style_id ? s.style_id : null;
    suggestions.push({ sceneId: scene.id, sceneNumber: scene.idx + 1, styleId, reason: s.reason });
  }
  suggestions.sort((a, b) => a.sceneNumber - b.sceneNumber);
  return { ok: true, suggestions };
}

/** Applies several scene styles at once (the "Apply all" of suggestions). */
export async function applySceneStyles(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  changes: { sceneId: string; styleId: string | null }[]
): Promise<ActionResult> {
  for (const change of changes) {
    const result = await setSceneStyle(orgId, brandId, productId, adId, change.sceneId, change.styleId);
    if (!result.ok) return result;
  }
  return { ok: true };
}
