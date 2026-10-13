"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { ScenePlanSchema } from "@/lib/claude/schemas/scene-plan";
import { SplitSceneCopySchema } from "@/lib/claude/schemas/split-scene-copy";
import { getAd } from "./ads-data";
import { getAdScripts } from "./scripts-data";
import type { SceneNote } from "./scenes-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Generates the scene plan for an ad: pulls the editor's selected
 * script (falling back to the manual brief if no script was
 * selected), splits it per the ad's style's cutting rule, clamps
 * nothing itself — clamping happens against the style's default
 * video model's duration range, read here and passed as context so
 * the model can account for it, per spec §5.4 step 3.
 */
export async function generateScenePlan(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  const scripts = await getAdScripts(orgId, adId);
  const selectedScript = scripts.find((s) => s.selected);

  let hook: string;
  let body: string;
  let cta: string;

  if (selectedScript) {
    hook = selectedScript.hook;
    body = selectedScript.body;
    cta = selectedScript.cta;
  } else if (ad.brief.hooks?.length || ad.brief.body || ad.brief.cta) {
    hook = (ad.brief.hooks ?? []).join(" ");
    body = ad.brief.body ?? "";
    cta = ad.brief.cta ?? "";
  } else {
    return {
      ok: false,
      error: "No script selected and no brief written yet — finish the Scripts or Brief step first.",
    };
  }

  let cuttingRule = "fast_cut";
  let durationRange: { min: number; max: number } | null = null;

  if (ad.style_id) {
    const { data: style, error: styleError } = await supabase
      .from("styles")
      .select("defaults, default_video_model_id")
      .eq("id", ad.style_id)
      .maybeSingle();
    if (styleError) return { ok: false, error: styleError.message };

    if (style?.defaults && typeof style.defaults === "object" && "cutting_rule" in style.defaults) {
      cuttingRule = String((style.defaults as Record<string, unknown>).cutting_rule);
    }

    if (style?.default_video_model_id) {
      const { data: provider, error: providerError } = await supabase
        .from("model_providers")
        .select("parameter_schema")
        .eq("model_id", style.default_video_model_id)
        .eq("is_default", true)
        .maybeSingle();
      if (providerError) return { ok: false, error: providerError.message };

      const durationField = (
        (provider?.parameter_schema as { key: string; options?: string[] }[]) ?? []
      ).find((f) => f.key === "duration");
      if (durationField?.options?.length) {
        const seconds = durationField.options.map(Number).filter((n) => !Number.isNaN(n));
        if (seconds.length) {
          durationRange = { min: Math.min(...seconds), max: Math.max(...seconds) };
        }
      }
    }
  }

  let output;
  try {
    const result = await llmCall({
      task: "generate_scene_plan",
      schema: ScenePlanSchema,
      orgId,
      input: {
        hook,
        body,
        cta,
        cutting_rule: cuttingRule,
        video_model_duration_range_s: durationRange,
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const service = createServiceClient();

  const { error: deleteError } = await service
    .from("scenes")
    .delete()
    .eq("org_id", orgId)
    .eq("ad_id", adId);
  if (deleteError) return { ok: false, error: deleteError.message };

  const rows = output.scenes.map((scene, i) => {
    let duration = scene.estimated_duration_s;
    if (durationRange) {
      duration = Math.min(Math.max(duration, durationRange.min), durationRange.max);
    }
    return {
      org_id: orgId,
      ad_id: adId,
      idx: i,
      hook_group: scene.hook_group,
      copy: scene.copy,
      duration_s: duration,
    };
  });

  const { error: insertError } = await service.from("scenes").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function updateSceneCopy(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  copy: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ copy })
    .eq("org_id", orgId)
    .eq("id", sceneId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function setSceneNote(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  note: SceneNote | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ notes: note ?? {} })
    .eq("org_id", orgId)
    .eq("id", sceneId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Splits a scene into two at a natural break point found by Claude
 * (end of a sentence/clause near the midpoint, never mid-word) —
 * replaces the old literal character-count midpoint split outright,
 * since the editor can already hand-edit either half's copy in the
 * textarea right after the split, so there's no need to keep a dumb
 * split as a separate manual option. Renumbers idx for every scene
 * after the split so ordering stays contiguous — spec §5.5:
 * "Splitting and merging renumber scenes without detaching assets"
 * (no assets exist yet at this step, but the renumbering behavior is
 * shared with the storyboard table built later).
 */
export async function splitScene(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { data: scene, error: fetchError } = await supabase
    .from("scenes")
    .select("idx, hook_group, copy")
    .eq("org_id", orgId)
    .eq("id", sceneId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!scene) return { ok: false, error: "Scene not found." };

  let splitOutput;
  try {
    const result = await llmCall({
      task: "split_scene_copy",
      schema: SplitSceneCopySchema,
      orgId,
      input: { copy: scene.copy },
    });
    splitOutput = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const first = splitOutput.first.trim();
  const second = splitOutput.second.trim();
  if (!first || !second) {
    return { ok: false, error: "Split point must leave text on both sides." };
  }

  const { data: laterScenes, error: laterError } = await supabase
    .from("scenes")
    .select("id, idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .gt("idx", scene.idx)
    .order("idx", { ascending: false });
  if (laterError) return { ok: false, error: laterError.message };

  for (const later of laterScenes ?? []) {
    const { error } = await supabase
      .from("scenes")
      .update({ idx: later.idx + 1 })
      .eq("id", later.id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: updateError } = await supabase
    .from("scenes")
    .update({ copy: first })
    .eq("id", sceneId);
  if (updateError) return { ok: false, error: updateError.message };

  const { error: insertError } = await supabase.from("scenes").insert({
    org_id: orgId,
    ad_id: adId,
    idx: scene.idx + 1,
    hook_group: scene.hook_group,
    copy: second,
  });
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Duplicates a scene as a new story beat inserted immediately after
 * it — "branch one scene" from the friction audit: an editor who
 * likes everything except one beat shouldn't have to re-plan the
 * whole ad to try a second version of it.
 *
 * Copies the structural/story fields (copy, visual, hook_group,
 * duration_s, route, speaker, video_idea) but deliberately drops
 * image_prompt_override (a sticky override is scoped to one scene's
 * own generation history — copying it would silently apply someone
 * else's locked-in prompt to a scene that never earned it) and any
 * already-generated image/video/vo/caption assets (those belong to
 * the source scene's row; a duplicate is a fresh beat to generate
 * for, not a clone of existing media — same reasoning splitScene's
 * doc comment gives for why split/merge never touch assets either).
 * Renumbers idx exactly like splitScene does, by shifting every later
 * scene up by one to make room.
 */
export async function duplicateScene(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { data: scene, error: fetchError } = await supabase
    .from("scenes")
    .select("idx, copy, visual, hook_group, duration_s, route, speaker, video_idea")
    .eq("org_id", orgId)
    .eq("id", sceneId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!scene) return { ok: false, error: "Scene not found." };

  const { data: laterScenes, error: laterError } = await supabase
    .from("scenes")
    .select("id, idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .gt("idx", scene.idx)
    .order("idx", { ascending: false });
  if (laterError) return { ok: false, error: laterError.message };

  for (const later of laterScenes ?? []) {
    const { error } = await supabase
      .from("scenes")
      .update({ idx: later.idx + 1 })
      .eq("id", later.id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: insertError } = await supabase.from("scenes").insert({
    org_id: orgId,
    ad_id: adId,
    idx: scene.idx + 1,
    copy: scene.copy,
    visual: scene.visual,
    hook_group: scene.hook_group,
    duration_s: scene.duration_s,
    route: scene.route,
    speaker: scene.speaker,
    video_idea: scene.video_idea,
  });
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/** Merges a scene into its preceding scene (copy concatenated), then renumbers. */
export async function mergeSceneIntoPrevious(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { data: scene, error: fetchError } = await supabase
    .from("scenes")
    .select("idx, copy")
    .eq("org_id", orgId)
    .eq("id", sceneId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!scene) return { ok: false, error: "Scene not found." };
  if (scene.idx === 0) return { ok: false, error: "Cannot merge the first scene into a previous one." };

  const { data: previous, error: prevError } = await supabase
    .from("scenes")
    .select("id, copy")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("idx", scene.idx - 1)
    .maybeSingle();
  if (prevError) return { ok: false, error: prevError.message };
  if (!previous) return { ok: false, error: "Previous scene not found." };

  const { error: updateError } = await supabase
    .from("scenes")
    .update({ copy: `${previous.copy} ${scene.copy}`.trim() })
    .eq("id", previous.id);
  if (updateError) return { ok: false, error: updateError.message };

  const { error: deleteError } = await supabase.from("scenes").delete().eq("id", sceneId);
  if (deleteError) return { ok: false, error: deleteError.message };

  const { data: laterScenes, error: laterError } = await supabase
    .from("scenes")
    .select("id, idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .gt("idx", scene.idx)
    .order("idx", { ascending: true });
  if (laterError) return { ok: false, error: laterError.message };

  for (const later of laterScenes ?? []) {
    const { error } = await supabase
      .from("scenes")
      .update({ idx: later.idx - 1 })
      .eq("id", later.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

