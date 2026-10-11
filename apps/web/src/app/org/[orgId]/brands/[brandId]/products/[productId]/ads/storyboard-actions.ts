"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { StoryboardPatchSchema, type StoryboardPatch } from "@/lib/claude/schemas/storyboard-patch";
import { getScenes } from "./scenes-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function toggleProductInFrame(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  inFrame: boolean
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ product_id: inFrame ? productId : null })
    .eq("org_id", orgId)
    .eq("id", sceneId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function updateSceneVisual(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  visual: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ visual })
    .eq("org_id", orgId)
    .eq("id", sceneId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export type PatchResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Spec §5.5 "Edit by chat": asks Claude for a narrowly-scoped patch
 * (not a board regeneration), validates it against the schema (zod
 * already enforces this via llm.call()), then applies only the
 * operations it named. Existing scenes/images/videos not named in
 * the patch are left completely untouched.
 */
export async function patchStoryboard(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  instruction: string
): Promise<PatchResult> {
  await requireOrgMember(orgId);

  const trimmed = instruction.trim();
  if (!trimmed) return { ok: false, error: "Enter an instruction first." };

  const scenes = await getScenes(orgId, adId);
  if (scenes.length === 0) return { ok: false, error: "No scenes to patch." };

  let output: StoryboardPatch;
  try {
    const result = await llmCall({
      task: "patch_storyboard",
      schema: StoryboardPatchSchema,
      orgId,
      input: {
        instruction: trimmed,
        storyboard: scenes.map((s) => ({
          idx: s.idx,
          hook_group: s.hook_group,
          copy: s.copy,
          visual: s.visual,
          product_in_frame: s.product_id !== null,
        })),
      },
    });
    output = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const supabase = await createClient();
  // Keyed by the idx values from the SAME snapshot given to Claude —
  // every scene_idx/after_scene_idx in the patch refers to this
  // original numbering, not whatever idx a scene ends up at mid-loop.
  // Edits and deletes resolve directly against this original map
  // (always valid, since editing/deleting an original row doesn't
  // change which original row another operation meant); adds are
  // applied last, against fresh post-edit/delete state, since an add
  // genuinely does need to know the CURRENT idx of its anchor scene
  // to insert after it correctly once earlier deletes have already
  // renumbered the table.
  const sceneByIdx = new Map(scenes.map((s) => [s.idx, s]));

  const edits = output.operations.filter((op) => op.kind === "edit");
  const deletes = output.operations.filter((op) => op.kind === "delete");
  const adds = output.operations.filter((op) => op.kind === "add");

  for (const op of edits) {
    const scene = sceneByIdx.get(op.scene_idx);
    if (!scene) continue;

    const updates: Record<string, unknown> = {};
    if (op.copy !== null) updates.copy = op.copy;
    if (op.visual !== null) updates.visual = op.visual;
    if (op.product_in_frame !== null) {
      updates.product_id = op.product_in_frame ? productId : null;
    }
    if (Object.keys(updates).length === 0) continue;

    const { error } = await supabase.from("scenes").update(updates).eq("id", scene.id);
    if (error) return { ok: false, error: error.message };
  }

  // Deletes applied highest-idx-first so each one's own renumbering
  // pass never has to account for a delete still pending below it.
  const sortedDeletes = [...deletes].sort((a, b) => b.scene_idx - a.scene_idx);
  for (const op of sortedDeletes) {
    const scene = sceneByIdx.get(op.scene_idx);
    if (!scene) continue;

    const { data: current, error: currentError } = await supabase
      .from("scenes")
      .select("idx")
      .eq("id", scene.id)
      .maybeSingle();
    if (currentError) return { ok: false, error: currentError.message };
    if (!current) continue;

    const { error: deleteError } = await supabase.from("scenes").delete().eq("id", scene.id);
    if (deleteError) return { ok: false, error: deleteError.message };

    const { data: laterScenes, error: laterError } = await supabase
      .from("scenes")
      .select("id, idx")
      .eq("org_id", orgId)
      .eq("ad_id", adId)
      .gt("idx", current.idx)
      .order("idx", { ascending: true });
    if (laterError) return { ok: false, error: laterError.message };

    for (const later of laterScenes ?? []) {
      const { error } = await supabase.from("scenes").update({ idx: later.idx - 1 }).eq("id", later.id);
      if (error) return { ok: false, error: error.message };
    }
  }

  for (const op of adds) {
    const anchor = sceneByIdx.get(op.after_scene_idx);
    if (!anchor) continue;

    const { data: currentAnchor, error: anchorError } = await supabase
      .from("scenes")
      .select("idx")
      .eq("id", anchor.id)
      .maybeSingle();
    if (anchorError) return { ok: false, error: anchorError.message };
    if (!currentAnchor) continue;

    const { data: laterScenes, error: laterError } = await supabase
      .from("scenes")
      .select("id, idx")
      .eq("org_id", orgId)
      .eq("ad_id", adId)
      .gt("idx", currentAnchor.idx)
      .order("idx", { ascending: false });
    if (laterError) return { ok: false, error: laterError.message };

    for (const later of laterScenes ?? []) {
      const { error } = await supabase.from("scenes").update({ idx: later.idx + 1 }).eq("id", later.id);
      if (error) return { ok: false, error: error.message };
    }

    const { error: insertError } = await supabase.from("scenes").insert({
      org_id: orgId,
      ad_id: adId,
      idx: currentAnchor.idx + 1,
      hook_group: op.hook_group,
      copy: op.copy,
      visual: op.visual,
      product_id: op.product_in_frame ? productId : null,
    });
    if (insertError) return { ok: false, error: insertError.message };
  }

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true, summary: output.summary };
}
