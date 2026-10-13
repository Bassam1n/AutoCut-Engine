"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { ClassifyFeedbackIsQuestionSchema } from "@/lib/claude/schemas/classify-feedback-question";
import { RewriteFeedbackPromptSchema } from "@/lib/claude/schemas/rewrite-feedback-prompt";
import { CheckReworkDiffSchema } from "@/lib/claude/schemas/check-rework-diff";
import { AnalyzeVideoFeedbackSchema } from "@/lib/claude/schemas/analyze-video-feedback";
import { generateReferenceImage } from "@/lib/providers/generate-reference-image";
import { startProviderJob } from "@/lib/jobs/run-job";
import { pickVideoFeedbackStillAsset } from "@/lib/feedback/target-asset";
import { getAd } from "./ads-data";
import { getScenes, type Scene } from "./scenes-data";
import { getActiveRulesForAd } from "./scene-images-data";
import { assembleSceneReferences, resolveFinalImagePrompt, type ModelChoice } from "./scene-images-actions";
import { getBrand } from "@/app/org/[orgId]/brands/brands-data";
import { getProduct } from "../../products-data";
import { isPathUnder } from "@/lib/access";

// Spec §5.8 ("Feedback, rules, history"). Server Actions for Tweak,
// Rework, and video feedback, following scene-images-actions.ts/
// scene-videos-actions.ts's exact conventions: requireOrgMember on
// every entry point, the existing asset-versioning pattern (new
// version row inserted, old stays), the existing provider pipeline
// (generateReferenceImage for images, startProviderJob for video) —
// the only genuinely new work here is the prompt-rewrite step and
// the gates around it (question rejection, placement detection,
// rework diff check).
//
// OUT OF SCOPE (per the spec's M8 remember/rules split): the
// `remember` boolean is persisted on feedback_events rows and nothing
// else — no rules screen, no distillation job, no rule-injection
// logic beyond the existing getActiveRulesForAd() call this file
// makes for prompt-writing context, same as original generation.

export type ActionResult = { ok: true } | { ok: false; error: string };

export type FeedbackTarget = "image" | "video" | "last_frame";
export type FeedbackMode = "tweak" | "rework";

export type FeedbackGateResult =
  | { ok: true }
  | { ok: false; error: string; isQuestion: boolean; rephraseHint: string | null };

/**
 * Spec §5.8: "Feedback phrased as a question is rejected before
 * spending anything, with a hint to rephrase it as a change." This
 * gate is called FIRST by every feedback entry point below, before
 * claim_paid_job is ever reached for the real rewrite/generation
 * work — llmCall() itself calls claim_paid_job before this
 * classification call runs too, which means even the classification
 * step has a tiny real cost (a Haiku call). That's accepted on
 * purpose: Haiku is the cheapest tier in the app's catalog
 * specifically so the cost of screening a question is negligible
 * next to the image/video generation it prevents — it is not free,
 * but it is structurally first and far cheaper than what it guards.
 */
export async function runQuestionGate(orgId: string, feedbackText: string): Promise<FeedbackGateResult> {
  // Exported server action that spends on the org's LLM key.
  await requireOrgMember(orgId);
  try {
    const result = await llmCall({
      task: "classify_feedback_is_question",
      schema: ClassifyFeedbackIsQuestionSchema,
      orgId,
      input: { feedback_text: feedbackText },
    });
    if (result.output.is_question) {
      return {
        ok: false,
        error: result.output.rephrase_hint
          ? `That reads like a question, not a change. ${result.output.rephrase_hint}`
          : "That reads like a question, not a change. Try rephrasing it as what you want changed.",
        isQuestion: true,
        rephraseHint: result.output.rephrase_hint,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message, isQuestion: false, rephraseHint: null };
    throw err;
  }
}

/**
 * Reserves a storage path for a Tweak/Rework round's attached
 * reference image — identical direct-to-Storage pattern as
 * scene-images-actions.ts's reserveFeedbackImageUploadPath, kept as a
 * separate function (rather than reusing that one verbatim) because
 * this upload is scoped to one feedback round rather than the
 * scene-wide feedback tier, and feeds assembleSceneReferences' new
 * tier (0), not tier (b).
 */
export async function reserveFeedbackRoundReferenceUploadPath(
  orgId: string,
  adId: string,
  sceneId: string,
  fileName: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  await requireOrgMember(orgId);

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/feedback_round/${adId}/${sceneId}/${Date.now()}_${safeName}`;

  return { ok: true, path };
}

/** Signs a feedback-round reference image upload for use as a generation reference, after the browser confirms the direct Storage upload succeeded. Does not record an assets row — this image is single-round, not part of the scene's persistent feedback-image tier. */
async function signFeedbackRoundReference(storagePath: string): Promise<string | null> {
  const service = createServiceClient();
  const { data, error } = await service.storage.from("renders").createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

export type TweakReworkResult =
  | {
      ok: true;
      feedbackEventId: string;
      assetId: string;
      changeSummary: string;
      requestType: "surgical" | "placement_or_removal";
      rebuiltWithoutReference: boolean;
      reworkDiff?: { passed: boolean; unrelatedChanges: string[] };
    }
  | { ok: false; error: string; isQuestion?: boolean; rephraseHint?: string | null }
  | { ok: false; error: string; reworkDiffFailed: true; unrelatedChanges: string[] };

/**
 * Tweak or Rework on a scene's current IMAGE (spec §5.8). Shared
 * implementation for both modes — they differ only in which prompt
 * task runs (rewrite_tweak_prompt vs rewrite_rework_prompt) and
 * whether the diff check runs afterward (rework only).
 *
 * Flow, in order:
 *   1. Question gate (structurally first, before any other paid call).
 *   2. Resolve the CURRENT final prompt that produced the existing
 *      asset (resolveFinalImagePrompt — same resolution logic as
 *      original generation: image_prompt_override if set, else
 *      re-resolve via write_image_prompt).
 *   3. Rewrite the prompt against the feedback text (rewrite_tweak_
 *      prompt / rewrite_rework_prompt), which also classifies
 *      request_type.
 *   4. Rework only: diff-check the rewrite (check_rework_diff) — a
 *      real pass/fail that can surface to the editor.
 *   5. Assemble references. If request_type is placement_or_removal,
 *      the old image is NOT included as a reference at all (spec:
 *      "rebuild without feeding the old image back, and say so") —
 *      achieved by omitting both the feedback-round attachment AND
 *      calling assembleSceneReferences with placement mode, which
 *      drops tier (a)/(b)/(c)/(e) too, since every one of those tiers
 *      is itself a visual reference the new shot should not be
 *      anchored to for a structural recompose. Only an explicit new
 *      feedback-round attachment survives (the editor's own deliberate
 *      choice), re-added after assembly.
 *   6. Generate via the existing generateReferenceImage() pipeline.
 *   7. Version and store the new asset (exact nextVersion/update
 *      pattern from generateSceneImages).
 *   8. Insert the feedback_events row (append-only, remember boolean
 *      persisted, nothing else built around it).
 */
export async function submitImageFeedback(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  mode: FeedbackMode,
  feedbackText: string,
  remember: boolean,
  model: ModelChoice,
  attachedReferenceStoragePath?: string
): Promise<TweakReworkResult> {
  await requireOrgMember(orgId);

  const gate = await runQuestionGate(orgId, feedbackText);
  if (!gate.ok) {
    return { ok: false, error: gate.error, isQuestion: gate.isQuestion, rephraseHint: gate.rephraseHint };
  }

  const scenes = await getScenes(orgId, adId);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene not found." };

  const currentPromptResult = await resolveFinalImagePrompt(orgId, brandId, productId, scene);
  if (!currentPromptResult.ok) return { ok: false, error: currentPromptResult.error };

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  const [brand, product] = await Promise.all([getBrand(orgId, brandId), getProduct(orgId, brandId, productId)]);
  if (!brand || !product) return { ok: false, error: "Brand or product not found." };

  const supabase = await createClient();
  let styleMasterprompt: string | null = null;
  if (ad.style_id) {
    const { data: style } = await supabase.from("styles").select("masterprompt").eq("id", ad.style_id).maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  const rules = await getActiveRulesForAd(orgId, brandId, ad.style_id, scene.product_id);

  const task = mode === "tweak" ? "rewrite_tweak_prompt" : "rewrite_rework_prompt";
  let rewrite;
  try {
    const result = await llmCall({
      task,
      schema: RewriteFeedbackPromptSchema,
      orgId,
      input: {
        current_prompt: currentPromptResult.prompt,
        feedback_text: feedbackText,
        brand_context: brand.brand_context,
        product: { name: product.name, category: product.category, what_it_is: product.what_it_is },
        style_masterprompt: styleMasterprompt,
        active_rules: rules.map((r) => ({ kind: r.kind, text: r.text })),
      },
    });
    rewrite = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  let reworkDiff: { passed: boolean; unrelatedChanges: string[] } | undefined;
  if (mode === "rework") {
    try {
      const diffResult = await llmCall({
        task: "check_rework_diff",
        schema: CheckReworkDiffSchema,
        orgId,
        input: {
          original_prompt: currentPromptResult.prompt,
          rewritten_prompt: rewrite.rewritten_prompt,
          feedback_text: feedbackText,
        },
      });
      reworkDiff = { passed: diffResult.output.passed, unrelatedChanges: diffResult.output.unrelated_changes };
    } catch (err) {
      if (err instanceof LlmCallError) return { ok: false, error: err.message };
      throw err;
    }

    // Spec §5.8: "a diff check confirms untouched parts survived." A
    // real check that can fail and be shown to the editor — when it
    // fails, stop here rather than spending on a generation the
    // editor hasn't confirmed they still want, given it drifted
    // somewhere unintended. The rewrite itself is NOT discarded
    // silently: the caller gets the full unrelated_changes list so
    // the editor can decide (accept anyway via a future resubmit, or
    // rephrase) rather than this function guessing for them.
    if (!reworkDiff.passed) {
      return {
        ok: false,
        error: "The rework changed more than what you asked for.",
        reworkDiffFailed: true,
        unrelatedChanges: reworkDiff.unrelatedChanges,
      };
    }
  }

  const isPlacementOrRemoval = rewrite.request_type === "placement_or_removal";

  // Spec §5.8: "Placement and 'remove the frame' requests rebuild
  // without feeding the old image back, and say so." The feedback-
  // round attachment (the editor's own deliberate new reference, if
  // any) is the ONE exception — it is not "the old image," it's a
  // fresh reference the editor chose for this exact round, so it is
  // still included even on a placement/removal rebuild.
  let feedbackRoundReferenceUrl: string | undefined;
  if (attachedReferenceStoragePath) {
    // Signed with the service role, so it must be the folder
    // reserveFeedbackRoundReferenceUploadPath() handed out for this scene.
    if (!isPathUnder(attachedReferenceStoragePath, `${orgId}/feedback_round/${adId}/${sceneId}/`)) {
      return { ok: false, error: "Invalid reference image path." };
    }
    feedbackRoundReferenceUrl = (await signFeedbackRoundReference(attachedReferenceStoragePath)) ?? undefined;
  }

  const referenceUrls: string[] = [];
  let omitted: { tier: string; count: number }[] = [];
  if (isPlacementOrRemoval) {
    // Every ordinary reference tier (product photo, scene-wide
    // feedback images, cast references, angle photos) is itself a
    // visual anchor to the OLD composition — all skipped for a
    // structural recompose. Only the editor's own fresh attachment
    // for this round, if given, is used.
    if (feedbackRoundReferenceUrl) referenceUrls.push(feedbackRoundReferenceUrl);
  } else {
    const assembled = await assembleSceneReferences(orgId, brandId, scene, feedbackRoundReferenceUrl);
    referenceUrls.push(...assembled.urls);
    omitted = assembled.omitted;
  }
  void omitted; // surfaced to the UI via the normal "omitted references" note path, same as original generation — not re-plumbed through this result type to avoid duplicating that UI contract.

  const imageResult = await generateReferenceImage({
    orgId,
    brandId,
    prompt: rewrite.rewritten_prompt,
    referenceImageUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
    provider: model.provider,
    endpoint: model.endpoint,
    attributedAdId: adId,
    spendKind: mode === "tweak" ? "image:tweak" : "image:rework",
  });
  if (!imageResult.ok) return { ok: false, error: imageResult.error };

  const service = createServiceClient();
  const { data: existingVersions } = await service
    .from("assets")
    .select("version")
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "image")
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existingVersions?.[0]?.version ?? 0) + 1;

  // Exact versioning pattern from generateSceneImages: a new version
  // row, old asset(s) stay (spec §5.9 "nothing generated is ever
  // lost" / §4's archive-never-delete rule) — this update only moves
  // the freshly-generated brand-scoped asset into this scene at the
  // next version number, same assets_ad_or_brand_check-safe update
  // (ad_id set, brand_id cleared in the same call).
  const { error: updateError } = await service
    .from("assets")
    .update({ ad_id: adId, brand_id: null, scene_id: sceneId, version: nextVersion })
    .eq("id", imageResult.assetId);
  if (updateError) return { ok: false, error: updateError.message };

  // Tweak/Rework targets and rewrites ONE existing image into a
  // replacement, unlike bulk Generate/Regenerate (scene-images-
  // actions.ts's generateSceneImages), which deliberately produces
  // 1-4 simultaneously-current images an editor picks between later
  // (scene-videos-step.tsx's own "pick which one to animate" picker).
  // Archiving every other prior non-archived image here, before this
  // call's own update() above landed the new one, would be wrong on
  // both counts; archiving them AFTER it (now, excluding the asset
  // that update() just moved into this scene) matches the "replace
  // the current one, keep history, allow restore" model Scene videos
  // already has — see getArchivedSceneImages/restoreArchivedImage.
  await service
    .from("assets")
    .update({ archived: true })
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "image")
    .eq("archived", false)
    .neq("id", imageResult.assetId);

  // Spec §5.8: regenerating a scene's image archives that scene's
  // videos — same rule generateSceneImages already applies, repeated
  // here since Tweak/Rework on the image is itself a regeneration.
  await service
    .from("assets")
    .update({ archived: true })
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "video")
    .eq("archived", false);

  const { data: feedbackEvent, error: feedbackError } = await supabase
    .from("feedback_events")
    .insert({
      org_id: orgId,
      ad_id: adId,
      scene_id: sceneId,
      target: "image",
      mode,
      text: feedbackText,
      remember,
    })
    .select("id")
    .single();
  if (feedbackError) return { ok: false, error: feedbackError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return {
    ok: true,
    feedbackEventId: feedbackEvent.id,
    assetId: imageResult.assetId,
    changeSummary: rewrite.change_summary,
    requestType: rewrite.request_type,
    rebuiltWithoutReference: isPlacementOrRemoval,
    reworkDiff,
  };
}

export type VideoFeedbackResult =
  | { ok: true; feedbackEventId: string; jobId: string; changeSummary: string }
  | { ok: false; error: string; isQuestion?: boolean; rephraseHint?: string | null }
  | { ok: false; error: string; reworkDiffFailed: true; unrelatedChanges: string[] };

/**
 * Tweak or Rework on a scene's current VIDEO (spec §5.8: "Video
 * feedback first analyses the current clip, then rewrites the video
 * prompt as a change against what the clip does.") scene-videos-
 * actions.ts's resolveFinalVideoPrompt() is NOT reused directly here
 * — that function is for the original generate path and takes an
 * already-approved motion plan plus hard-enforced spoken-copy nulling
 * as input, not a rewrite-against-feedback input. Instead this calls
 * analyze_video_feedback for the "first analyses" step, then runs the
 * same rewrite_tweak_prompt/rewrite_rework_prompt + optional
 * check_rework_diff gates as the image path, with the analysis folded
 * into current_prompt context, then hands the rewritten prompt to the
 * existing startProviderJob pipeline exactly as generateSceneVideo
 * already does — no new provider-submission logic.
 */
export async function submitVideoFeedback(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  mode: FeedbackMode,
  feedbackText: string,
  remember: boolean,
  model: ModelChoice
): Promise<VideoFeedbackResult> {
  await requireOrgMember(orgId);

  const gate = await runQuestionGate(orgId, feedbackText);
  if (!gate.ok) {
    return { ok: false, error: gate.error, isQuestion: gate.isQuestion, rephraseHint: gate.rephraseHint };
  }

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  const scenes = await getScenes(orgId, adId);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene not found." };

  const service = createServiceClient();
  const { data: sceneAssets } = await service
    .from("assets")
    .select("id, kind, version, storage_path")
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("archived", false);

  const stillPick = pickVideoFeedbackStillAsset(sceneAssets ?? []);
  if (!stillPick) return { ok: false, error: "No existing image or video frame found to analyze for this scene." };

  const { data: signedStill, error: signError } = await service.storage
    .from("renders")
    .createSignedUrl((stillPick.asset as { storage_path: string }).storage_path, 3600);
  if (signError || !signedStill) return { ok: false, error: signError?.message ?? "Could not load the current clip's frame." };

  // Spec §5.8's "first analyses the current clip" step — HONEST
  // LIMITATION (see analyze-video-feedback.ts): this is a vision call
  // over a still frame, never the actual video, since Claude has no
  // video-input capability. Run before the rewrite step so the
  // rewrite has real "what the clip does" context to change against,
  // rather than inventing it from the motion plan alone.
  let clipDescription: string;
  try {
    const result = await llmCall({
      task: "analyze_video_feedback",
      schema: AnalyzeVideoFeedbackSchema,
      orgId,
      imageUrls: [signedStill.signedUrl],
      input: {
        visual: scene.visual,
        copy: scene.copy,
        video_idea: scene.video_idea,
        is_last_frame: stillPick.isLastFrame,
      },
    });
    clipDescription = result.output.current_clip_description;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  const [brand] = await Promise.all([getBrand(orgId, brandId)]);
  if (!brand) return { ok: false, error: "Brand not found." };

  const supabase = await createClient();
  let styleMasterprompt: string | null = null;
  if (ad.style_id) {
    const { data: style } = await supabase.from("styles").select("masterprompt").eq("id", ad.style_id).maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  const rules = await getActiveRulesForAd(orgId, brandId, ad.style_id, scene.product_id);

  const task = mode === "tweak" ? "rewrite_tweak_prompt" : "rewrite_rework_prompt";
  let rewrite;
  try {
    const result = await llmCall({
      task,
      schema: RewriteFeedbackPromptSchema,
      orgId,
      input: {
        // The video path has no single saved "current prompt" string
        // the way images do (image_prompt_override) — the clip's
        // analyzed description IS the thing the rewrite changes
        // against, per spec: "rewrites the video prompt as a change
        // against what the clip does."
        current_prompt: clipDescription,
        feedback_text: feedbackText,
        brand_context: brand.brand_context,
        product: null,
        style_masterprompt: styleMasterprompt,
        active_rules: rules.map((r) => ({ kind: r.kind, text: r.text })),
      },
    });
    rewrite = result.output;
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  if (mode === "rework") {
    let diffPassed: boolean;
    let unrelatedChanges: string[];
    try {
      const diffResult = await llmCall({
        task: "check_rework_diff",
        schema: CheckReworkDiffSchema,
        orgId,
        input: {
          original_prompt: clipDescription,
          rewritten_prompt: rewrite.rewritten_prompt,
          feedback_text: feedbackText,
        },
      });
      diffPassed = diffResult.output.passed;
      unrelatedChanges = diffResult.output.unrelated_changes;
    } catch (err) {
      if (err instanceof LlmCallError) return { ok: false, error: err.message };
      throw err;
    }
    if (!diffPassed) {
      return {
        ok: false,
        error: "The rework changed more than what you asked for.",
        reworkDiffFailed: true,
        unrelatedChanges,
      };
    }
  }

  const sourceImageUrl = signedStill.signedUrl;
  const priceUnit = videoPriceUnitFor(model.endpoint);

  const jobResult = await startProviderJob(orgId, scene.id, "generate_scene_video", {
    orgId,
    brandId,
    provider: model.provider,
    endpoint: model.endpoint,
    prompt: rewrite.rewritten_prompt,
    referenceImageUrls: [sourceImageUrl],
    aspectRatio: "9:16",
    extra: {},
    priceUnit,
    spendKind: mode === "tweak" ? "video:tweak" : "video:rework",
  });
  if (!jobResult.ok) return { ok: false, error: jobResult.error };

  // Spec §5.8: regenerating video is the leaf of the archive chain
  // (image regen archives video; video feedback doesn't need to
  // archive anything further downstream since nothing in this app
  // derives an asset FROM a video yet).
  const { data: feedbackEvent, error: feedbackError } = await supabase
    .from("feedback_events")
    .insert({
      org_id: orgId,
      ad_id: adId,
      scene_id: sceneId,
      target: "video",
      mode,
      text: feedbackText,
      remember,
    })
    .select("id")
    .single();
  if (feedbackError) return { ok: false, error: feedbackError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true, feedbackEventId: feedbackEvent.id, jobId: jobResult.jobId, changeSummary: rewrite.change_summary };
}

/** price_table unit lookup for video feedback's provider submission — same mapping scene-videos-actions.ts's priceUnitForVideoEndpoint uses, duplicated here rather than exported from that file since that function is not currently exported and this file shouldn't widen that module's public surface just for one shared switch. */
function videoPriceUnitFor(endpoint: string): "per_image" | "per_video" | "per_second" {
  switch (endpoint) {
    case "kling-3.0/video":
    case "minimax-h3/image-to-video":
    case "bytedance/seedance-2":
    case "bytedance/seedance-2-5":
      return "per_second";
    default:
      return "per_video";
  }
}

/** Scene type re-export convenience so callers of this file's exports don't need a second import from scenes-data.ts just for the type. */
export type { Scene };
