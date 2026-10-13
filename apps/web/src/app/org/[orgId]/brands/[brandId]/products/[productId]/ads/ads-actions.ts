"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember, canCreateAds } from "@/lib/auth";
import { getAd } from "./ads-data";
import { getAdScripts } from "./scripts-data";
import { getScenes } from "./scenes-data";
import type { AdBrief } from "./ads-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type StudioStepValue =
  | "scripts"
  | "brief"
  | "dial_in"
  | "plan"
  | "concept"
  | "storyboard"
  | "scene_images"
  | "voiceover"
  | "scene_videos"
  | "export";

/**
 * Persists which Studio step the editor is actually on, so reopening
 * the ad later (new tab, different device, closed laptop) resumes
 * exactly there instead of re-guessing from scene/script state —
 * initialStep()'s old heuristic in studio-canvas.tsx had a hard
 * ceiling at "concept" and never recognized real progress into
 * Storyboard or Scene images. Fired on every step change, so this
 * deliberately skips revalidatePath — it's a background write for the
 * next page load, not something the current render needs to reflect.
 */
export async function saveCurrentStep(
  orgId: string,
  adId: string,
  step: StudioStepValue
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ current_step: step })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createAd(
  orgId: string,
  brandId: string,
  productId: string,
  styleId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  if (!(await canCreateAds(orgId))) {
    return { ok: false, error: "You don't have permission to create ads. Ask the platform admin to turn it on." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ads")
    .insert({
      org_id: orgId,
      brand_id: brandId,
      product_id: productId,
      style_id: styleId,
      mode: "studio",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  redirect(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${data.id}`);
}

export async function saveBrief(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  brief: AdBrief
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ brief })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function lockPlan(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ plan_locked: true })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function renameAd(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  name: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const trimmed = name.trim();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ name: trimmed || null })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  return { ok: true };
}

/**
 * Archives an ad — spec §4's own "archive, never delete" rule for
 * generated work, applied here too. Hides it from the default ads
 * list without removing any of its scripts/scenes/concepts/cast/
 * spend history.
 */
export async function archiveAd(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ archived: true })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  return { ok: true };
}

/**
 * Duplicates an ad for the "same script, different cast/style"
 * workflow agencies actually use (re-running scripts→scene-plan from
 * scratch for every variant is the friction this exists to remove).
 *
 * Decision: copy the brief + selected script + locked scene plan, but
 * deliberately NOT the concept/cast or any generated images/videos.
 * "Different cast/style" means concept+cast is exactly the part that
 * must NOT carry over — copying it would just hand the editor a
 * concept they're trying to replace. And since assets (images/videos)
 * are keyed to scene rows (scene_id), and the duplicate's scenes get
 * fresh ids while its cast is intentionally blank, there is no valid
 * cast/style context for any copied asset row to point at — carrying
 * them forward wouldn't just be wasteful, it would be wrong (media
 * generated for the old cast attached to a scene the new cast hasn't
 * touched). So the duplicate regenerates concept→cast→storyboard→
 * images/videos itself, same as any other new variant.
 *
 * Scripts and scenes, however, are pure text — safe to copy verbatim
 * — and are the expensive-to-regenerate part "same script" implies
 * keeping. The duplicate's scenes also drop plan_locked's downstream
 * side effects by being inserted already unlocked-but-complete: we
 * copy plan_locked as true (the plan is still valid copy), which lets
 * the editor land straight on Concept & cast instead of re-doing the
 * scene-plan step too.
 */
export async function duplicateAd(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  if (!(await canCreateAds(orgId))) {
    return { ok: false, error: "You don't have permission to create ads. Ask the platform admin to turn it on." };
  }

  const source = await getAd(orgId, productId, adId);
  if (!source) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();

  const sourceName = source.name?.trim() || "Untitled ad";
  const { data: created, error: insertError } = await supabase
    .from("ads")
    .insert({
      org_id: orgId,
      brand_id: brandId,
      product_id: productId,
      style_id: source.style_id,
      mode: source.mode,
      brief: source.brief,
      target_length_seconds: source.target_length_seconds,
      name: `${sourceName} (copy)`,
    })
    .select("id")
    .single();

  if (insertError) return { ok: false, error: insertError.message };
  const newAdId = created.id as string;

  // Service client: these inserts span rows the editor doesn't
  // directly own yet (the new ad isn't "theirs" via any RLS policy
  // keyed off an existing relationship), mirroring how scripts/scene
  // generation already use the service client for bulk replace.
  const service = createServiceClient();

  const [scripts, scenes] = await Promise.all([
    getAdScripts(orgId, adId),
    getScenes(orgId, adId),
  ]);

  if (scripts.length > 0) {
    const { error } = await service.from("ad_scripts").insert(
      scripts.map((s) => ({
        org_id: orgId,
        ad_id: newAdId,
        variant_index: s.variant_index,
        hook: s.hook,
        body: s.body,
        cta: s.cta,
        selected: s.selected,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  let newCurrentStep: StudioStepValue = "scripts";
  if (scenes.length > 0) {
    const { error } = await service.from("scenes").insert(
      scenes.map((s) => ({
        org_id: orgId,
        ad_id: newAdId,
        idx: s.idx,
        hook_group: s.hook_group,
        copy: s.copy,
        visual: s.visual,
        duration_s: s.duration_s,
        route: s.route,
        speaker: s.speaker,
        video_idea: s.video_idea,
      }))
    );
    if (error) return { ok: false, error: error.message };
    newCurrentStep = "concept";
  }

  const { error: stepError } = await supabase
    .from("ads")
    .update({
      plan_locked: scenes.length > 0 ? source.plan_locked : false,
      current_step: newCurrentStep,
    })
    .eq("org_id", orgId)
    .eq("id", newAdId);
  if (stepError) return { ok: false, error: stepError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  redirect(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${newAdId}`);
}

export async function unarchiveAd(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ archived: false })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  return { ok: true };
}
