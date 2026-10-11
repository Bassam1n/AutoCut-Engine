"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { SceneVisualsSchema } from "@/lib/claude/schemas/scene-visuals";
import type { ConceptOption } from "@/lib/claude/schemas/concepts";
import { getAd } from "./ads-data";
import { getScenes } from "./scenes-data";
import { getCastMembers } from "./concepts-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Storyboard generation (spec §5.4 step 5) — this is where Hermes'
 * old Visual Director phase's per-scene editorial judgment lands in
 * this rebuild, not in Concept & cast and not as a separate step
 * (see docs/adr/002-open-decisions.md). Writes scenes.visual and
 * scenes.route for every locked scene, plus the shared WORLD block
 * text folded into each scene's visual description.
 */
export async function generateSceneVisuals(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };
  if (!ad.plan_locked) return { ok: false, error: "Lock the scene plan first." };

  const { data: concept, error: conceptError } = await supabase
    .from("concepts")
    .select("options, selected_idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .maybeSingle();
  if (conceptError) return { ok: false, error: conceptError.message };
  if (!concept || concept.selected_idx === null) {
    return { ok: false, error: "Select a concept before generating the storyboard." };
  }
  const selectedConcept = (concept.options as ConceptOption[])[concept.selected_idx];

  const scenes = await getScenes(orgId, adId);
  if (scenes.length === 0) return { ok: false, error: "No scenes found." };

  const castMembers = await getCastMembers(orgId, adId);

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
      task: "generate_scene_visuals",
      schema: SceneVisualsSchema,
      orgId,
      input: {
        scenes: scenes.map((s) => ({ idx: s.idx, hook_group: s.hook_group, copy: s.copy })),
        concept: selectedConcept,
        cast: castMembers.map((c) => ({ name: c.name, description: c.description })),
        style_masterprompt: styleMasterprompt,
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const worldByLocation = new Map(output.world_locations.map((w) => [w.name, w.description]));
  const sceneByIdx = new Map(scenes.map((s) => [s.idx, s]));

  for (const sceneVisual of output.scenes) {
    const scene = sceneByIdx.get(sceneVisual.scene_idx);
    if (!scene) continue;

    const worldSentence = sceneVisual.world_location
      ? worldByLocation.get(sceneVisual.world_location)
      : null;
    const visual = worldSentence ? `${worldSentence} ${sceneVisual.visual}` : sceneVisual.visual;

    const { error } = await supabase
      .from("scenes")
      .update({
        visual,
        route: sceneVisual.route,
        product_id: sceneVisual.product_in_frame ? productId : null,
      })
      .eq("org_id", orgId)
      .eq("id", scene.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
