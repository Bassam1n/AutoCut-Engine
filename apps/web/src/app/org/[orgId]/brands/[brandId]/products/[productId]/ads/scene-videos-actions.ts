"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { PlanVideoMotionSchema } from "@/lib/claude/schemas/plan-video-motion";
import { WriteVideoPromptSchema } from "@/lib/claude/schemas/write-video-prompt";
import { startProviderJob, getJobStatus as getJobStatusAction } from "@/lib/jobs/run-job";
import {
  defaultSceneVideoDurationS,
  parseVideoDurationField,
  clampToVideoDurationField,
  countWords,
  resolveSceneSpeaks,
} from "@/lib/video/duration";
import { pickShortenedPrompt, videoPromptCharLimitFor, type ShorteningStage } from "@/lib/video/prompt-shortening";
import { getAd } from "./ads-data";
import type { AdBrief } from "./ads-data";
import { getScenes, type Scene } from "./scenes-data";
import { getActiveRulesForAd } from "./scene-images-data";
import { getCurrentSceneVoiceoverAsset } from "./scene-videos-data";
import { getProduct } from "../../products-data";
import { canAccessJob, getAccessibleAsset } from "@/lib/access";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ModelChoice = { provider: "fal" | "kie"; endpoint: string };

// resolveSceneSpeaks() moved to lib/video/duration.ts — this file is
// a "use server" Server Actions module (every export must be async),
// so the pure, synchronously-testable speaking-resolution logic lives
// there instead and is imported back in here.

export type MotionPreflightResult =
  | { ok: true; isPlausible: true; motionPlan: string }
  | { ok: true; isPlausible: false; reason: string; fallbackMotionPlan: string | null }
  | { ok: false; error: string };

/**
 * Spec §5.7's motion preflight — run BEFORE any paid provider call.
 * "image" is a signed URL to the chosen scene image (vision input via
 * llmCall's imageUrls). Never calls a provider itself; only decides
 * whether it's safe to.
 */
export async function runMotionPreflight(
  orgId: string,
  scene: Scene,
  imageUrl: string,
  speaks: boolean,
  productRealWorldSize?: string | null
): Promise<MotionPreflightResult> {
  // Exported server action that spends on the org's LLM key.
  await requireOrgMember(orgId);
  try {
    const result = await llmCall({
      task: "plan_video_motion",
      schema: PlanVideoMotionSchema,
      orgId,
      imageUrls: [imageUrl],
      input: {
        visual: scene.visual,
        copy: scene.copy,
        video_idea: scene.video_idea,
        scene_speaks: speaks,
        product_real_world_size: productRealWorldSize ?? null,
      },
    });
    const output = result.output;
    if (output.is_plausible) {
      return { ok: true, isPlausible: true, motionPlan: output.motion_plan ?? "" };
    }
    return {
      ok: true,
      isPlausible: false,
      reason: output.reason ?? "This image can't be animated the way it was asked.",
      fallbackMotionPlan: output.fallback_motion_plan,
    };
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }
}

export type ResolveVideoPromptResult =
  | { ok: true; prompt: string; stageUsed: ShorteningStage; trimmedNote: string | null }
  | { ok: false; error: string };

/**
 * Resolves the final video prompt for a scene from an already-approved
 * motion plan (spec §5.7 staged shortening): writes the full prompt
 * via write_video_prompt, and only if it doesn't fit the model's
 * length limit, asks for progressively tighter rewrites — tighter
 * rewrite, full rewrite, action-and-copy-only — stopping with a clear
 * error if even the last stage doesn't fit (never silently truncated
 * mid-sentence, matching pickShortenedPrompt's contract in
 * lib/video/prompt-shortening.ts).
 *
 * HARD SPEC REQUIREMENT (spec §5.7: "If nobody speaks, copy never
 * enters the video prompt"): spokenCopy is computed by the caller via
 * resolveSceneSpeaks() and passed in here already resolved to either
 * the scene's real copy or null — this function never reads
 * scene.copy directly for the write_video_prompt input, specifically
 * so a "nobody" speaking rule can never leak copy into the prompt by
 * a future refactor accidentally wiring scene.copy back in here.
 */
export async function resolveFinalVideoPrompt(
  orgId: string,
  scene: Scene,
  motionPlan: string,
  spokenCopy: string | null,
  styleMasterprompt: string | null,
  rules: { kind: "do" | "avoid"; text: string }[],
  endpoint: string,
  productRealWorldSize?: string | null
): Promise<ResolveVideoPromptResult> {
  // Exported server action that spends on the org's LLM key.
  await requireOrgMember(orgId);
  const charLimit = videoPromptCharLimitFor(endpoint);

  async function writeOnce(shortenInstruction: string | null): Promise<string> {
    const result = await llmCall({
      task: "write_video_prompt",
      schema: WriteVideoPromptSchema,
      orgId,
      input: {
        motion_plan: motionPlan,
        visual: scene.visual,
        // HARD SPEC REQUIREMENT ENFORCED HERE (spec §5.7: "If nobody
        // speaks, copy never enters the video prompt.") spokenCopy is
        // null whenever the speaking rule says this scene is silent —
        // that null is passed straight through, never substituted
        // with scene.copy, so a silent scene's copy is structurally
        // incapable of reaching this Claude call's input at all.
        spoken_copy: spokenCopy,
        style_masterprompt: styleMasterprompt,
        active_rules: rules,
        shorten_instruction: shortenInstruction,
        product_real_world_size: productRealWorldSize ?? null,
      },
    });
    return result.output.final_prompt;
  }

  let fullPrompt: string;
  try {
    fullPrompt = await writeOnce(null);
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  if (fullPrompt.length <= charLimit) {
    return { ok: true, prompt: fullPrompt, stageUsed: "full", trimmedNote: null };
  }

  // Stage 2: tighter Claude rewrite.
  let tighterRewrite: string;
  try {
    tighterRewrite = await writeOnce(
      "Your previous answer was too long for this model's prompt limit. Rewrite it tighter — same content, more concise phrasing."
    );
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  let staged = pickShortenedPrompt(fullPrompt, { tighter_rewrite: tighterRewrite }, charLimit);
  if (staged.ok) return { ok: true, prompt: staged.prompt, stageUsed: staged.stageUsed, trimmedNote: staged.trimmedNote };

  // Stage 3: full rewrite from scratch.
  let fullRewrite: string;
  try {
    fullRewrite = await writeOnce(
      "Your previous answers were still too long. Write a completely fresh, much shorter prompt from scratch — keep only the essential action and spoken copy."
    );
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  staged = pickShortenedPrompt(fullPrompt, { tighter_rewrite: tighterRewrite, full_rewrite: fullRewrite }, charLimit);
  if (staged.ok) return { ok: true, prompt: staged.prompt, stageUsed: staged.stageUsed, trimmedNote: staged.trimmedNote };

  // Stage 4: drop the visual description — the starting image already carries it.
  let actionAndCopyOnly: string;
  try {
    actionAndCopyOnly = await writeOnce(
      "Still too long. Drop ALL visual/scene description entirely — the starting image already shows that. Keep ONLY the core action to animate plus the spoken copy if any."
    );
  } catch (err) {
    if (err instanceof LlmCallError) return { ok: false, error: err.message };
    throw err;
  }

  staged = pickShortenedPrompt(
    fullPrompt,
    { tighter_rewrite: tighterRewrite, full_rewrite: fullRewrite, action_and_copy_only: actionAndCopyOnly },
    charLimit
  );
  if (staged.ok) return { ok: true, prompt: staged.prompt, stageUsed: staged.stageUsed, trimmedNote: staged.trimmedNote };

  return { ok: false, error: staged.error };
}

export type GenerateSceneVideoResult =
  | { ok: true; jobId: string; trimmedNote: string | null }
  | {
      ok: false;
      error: string;
      stoppedAtPreflight?: boolean;
      /** Set only when the preflight failed but offered a workable alternative (spec §5.7: "offer to animate what the moment can still do") — the UI shows an "Animate this instead" button that calls generateSceneVideoWithFallbackMotion with this exact plan. */
      fallbackMotionPlan?: string;
    };

/**
 * Starts Scene-video generation for one scene (spec §5.7). Unlike
 * Scene images' inline generateSceneImages(), this returns almost
 * immediately — it runs the motion preflight and prompt resolution
 * inline (neither is a paid provider call: preflight is a Claude
 * vision call that must complete before any provider spend happens,
 * and prompt writing is also just a Claude call), then hands the
 * actual provider submit-and-poll off to startProviderJob() /
 * run-provider-job.ts, which survives tab closes and reloads (spec:
 * "Jobs run server side... survive tab closes and reloads") — no
 * large `maxDuration` export is needed on this action's route the way
 * Scene images' old inline-poll pattern needed one, since this action
 * doesn't block on the provider job finishing.
 */
export async function generateSceneVideo(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  sourceImageAssetId: string,
  sourceImageUrl: string,
  durationS: number,
  model: ModelChoice
): Promise<GenerateSceneVideoResult> {
  await requireOrgMember(orgId);

  const ad = await getAd(orgId, productId, adId);
  if (!ad || ad.brand_id !== brandId) return { ok: false, error: "Ad not found." };

  const scenes = await getScenes(orgId, adId);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene not found." };

  const speaks = resolveSceneSpeaks(ad.brief.speaking, scene);
  const product = await getProduct(orgId, brandId, productId);

  // (a) Motion preflight — spec §5.7: run BEFORE any paid call, stop
  // entirely (no provider call, no spend) on a plain stop message
  // when it fails and offers no fallback.
  const preflight = await runMotionPreflight(orgId, scene, sourceImageUrl, speaks, product?.real_world_size);
  if (!preflight.ok) return { ok: false, error: preflight.error };
  if (!preflight.isPlausible) {
    // Stop entirely — no provider call, no spend (spec §5.7) — either
    // way. When a fallback plan exists, it rides along on the result
    // so the UI can offer "Animate this instead," which calls
    // generateSceneVideoWithFallbackMotion() with this exact plan
    // rather than re-running the vision call to ask the same question
    // twice.
    return {
      ok: false,
      error: preflight.reason,
      stoppedAtPreflight: true,
      fallbackMotionPlan: preflight.fallbackMotionPlan ?? undefined,
    };
  }

  return startGenerationWithMotionPlan(
    orgId,
    brandId,
    productId,
    adId,
    scene,
    ad,
    sourceImageAssetId,
    sourceImageUrl,
    durationS,
    model,
    preflight.motionPlan,
    speaks
  );
}

/**
 * Entry point for the UI's "Animate this instead" button — spec
 * §5.7: "offer to animate what the moment can still do." Skips
 * straight to prompt resolution + job submission with the
 * editor-accepted fallback motion plan, since the preflight already
 * ran once and already decided this fallback is the right one to
 * offer; re-running the vision call again would just ask the same
 * question a second time.
 */
export async function generateSceneVideoWithFallbackMotion(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  sourceImageAssetId: string,
  sourceImageUrl: string,
  durationS: number,
  model: ModelChoice,
  fallbackMotionPlan: string
): Promise<GenerateSceneVideoResult> {
  await requireOrgMember(orgId);

  const ad = await getAd(orgId, productId, adId);
  if (!ad || ad.brand_id !== brandId) return { ok: false, error: "Ad not found." };

  const scenes = await getScenes(orgId, adId);
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene not found." };

  const speaks = resolveSceneSpeaks(ad.brief.speaking, scene);

  return startGenerationWithMotionPlan(
    orgId,
    brandId,
    productId,
    adId,
    scene,
    ad,
    sourceImageAssetId,
    sourceImageUrl,
    durationS,
    model,
    fallbackMotionPlan,
    speaks
  );
}

async function startGenerationWithMotionPlan(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  scene: Scene,
  ad: { style_id: string | null; brief: AdBrief },
  sourceImageAssetId: string,
  sourceImageUrl: string,
  durationS: number,
  model: ModelChoice,
  motionPlan: string,
  speaks: boolean
): Promise<GenerateSceneVideoResult> {
  const supabase = await createClient();

  let styleMasterprompt: string | null = null;
  if (ad.style_id) {
    const { data: style } = await supabase.from("styles").select("masterprompt").eq("id", ad.style_id).maybeSingle();
    styleMasterprompt = style?.masterprompt ?? null;
  }

  const rules = await getActiveRulesForAd(orgId, brandId, ad.style_id, scene.product_id);
  const product = await getProduct(orgId, brandId, productId);

  // HARD SPEC REQUIREMENT (spec §5.7: "If nobody speaks, copy never
  // enters the video prompt"). speaks is resolved by
  // resolveSceneSpeaks() against ads.brief.speaking before this
  // point — spokenCopy is null here whenever this scene doesn't
  // speak, so resolveFinalVideoPrompt() below receives null, not
  // scene.copy, and copy is structurally unable to appear in the
  // final video prompt for a silent scene.
  const spokenCopy = speaks ? scene.copy : null;

  const promptResult = await resolveFinalVideoPrompt(
    orgId,
    scene,
    motionPlan,
    spokenCopy,
    styleMasterprompt,
    rules.map((r) => ({ kind: r.kind, text: r.text })),
    model.endpoint,
    product?.real_world_size
  );
  if (!promptResult.ok) return { ok: false, error: promptResult.error };

  // Models with native audio (spec §5.7: "Models with native audio
  // can speak the line") get an extra, minimal hint in the provider
  // payload rather than deep audio-script wiring — see
  // sceneVideoExtraParams() below for exactly what "minimal" means
  // here.
  const extra = sceneVideoExtraParams(model.endpoint, speaks);

  const priceUnit = priceUnitForVideoEndpoint(model.endpoint);

  // Per-scene reference audio (user-confirmed requirement: "use
  // reference audio while creating the video"), OPTIONAL — a scene
  // with no current voiceover generates its video exactly as before,
  // no hard dependency. When this scene has a current (non-archived)
  // kind='vo' asset, its signed URL is fetched the same way
  // sourceImageUrl already is for images, and passed through as
  // referenceAudioUrls — KieAdapter.submit() is the only place that
  // decides whether a given model's payload actually uses it (see
  // kie.ts: only bytedance/seedance-2, bytedance/seedance-2-5 and
  // kling-3.0/video map it to a real field; every other model is a
  // no-op for this parameter, not a guess).
  let referenceAudioUrls: string[] | undefined;
  const voAsset = await getCurrentSceneVoiceoverAsset(orgId, scene.id);
  if (voAsset) {
    const service = createServiceClient();
    const { data: signed } = await service.storage.from("renders").createSignedUrl(voAsset.storage_path, 3600);
    if (signed?.signedUrl) referenceAudioUrls = [signed.signedUrl];
  }

  const jobResult = await startProviderJob(orgId, scene.id, "generate_scene_video", {
    orgId,
    brandId,
    provider: model.provider,
    endpoint: model.endpoint,
    prompt: promptResult.prompt,
    referenceImageUrls: [sourceImageUrl],
    referenceAudioUrls,
    // 9:16 was only ever baked into the prompt TEXT (e.g. "...9:16
    // vertical"), never sent as a real request parameter. That's a
    // text hint, not a constraint — seedance-2-5's own aspect_ratio
    // default is "adaptive" (picks its own ratio, commonly from the
    // input image) when this field is omitted, which is exactly why
    // the output wasn't actually 9:16. Every ad in this app is
    // vertical-only per spec (every seeded style masterprompt/image
    // prompt already assumes 9:16) — hardcoded here rather than
    // plumbed from a setting that doesn't exist yet.
    aspectRatio: "9:16",
    extra: { ...extra, duration: String(Math.round(durationS)) },
    priceUnit,
    spendKind: "video:scene_video",
  });

  if (!jobResult.ok) return { ok: false, error: jobResult.error };

  // Stash the source image asset id and scene id on the job's own
  // payload isn't needed beyond what startProviderJob already wrote
  // (job.scene_id is set by request_scene_regen) — recorded instead
  // on the scenes row isn't necessary either; onSceneVideoJobSucceeded
  // (called by the polling UI once status flips to "succeeded")
  // reads job.scene_id/ad_id directly off the jobs row itself.
  void productId;
  void sourceImageAssetId;

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true, jobId: jobResult.jobId, trimmedNote: promptResult.trimmedNote };
}

/**
 * Minimal surfacing of a model's native-audio capability (spec §5.7:
 * "Models with native audio can speak the line... don't build deep
 * audio-script wiring"). kling-3's registry entry documents
 * "Supports multi-shot generation and audio" (supabase/seed_models.sql)
 * and its parameter_schema has a boolean `sound` field — when this
 * scene speaks and the chosen model is one of the audio-capable ones,
 * this just flips that boolean on so the provider's own native TTS/
 * lip-sync (whatever it does internally) has a chance to fire,
 * without this app writing or sending any separate audio script.
 * fal.ai's kling-v3-pro-i2v similarly has a `generate_audio` boolean.
 * Every other model's schema has no audio-related field at all, so
 * this returns {} for them — no invented field sent to a provider
 * that doesn't document one.
 */
function sceneVideoExtraParams(endpoint: string, speaks: boolean): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (speaks) {
    if (endpoint === "kling-3.0/video") extra.sound = true;
    if (endpoint === "fal-ai/kling-video/v3/pro/image-to-video") extra.generate_audio = true;
  }
  // bytedance/seedance-2-5's real request payload (user-confirmed
  // 2026-10-12) has a documented return_last_frame field — kie.ai can
  // hand back a video's last frame natively, no ffmpeg needed (the
  // original reason last_frame asset writing was skipped in this
  // milestone's first pass). Only enabled for this one model since
  // it's the only one with a confirmed real payload showing the
  // field; the RESPONSE shape when this is set hasn't been seen yet,
  // so finalizeSceneVideoJob doesn't parse/save a last_frame asset
  // from it yet — that's the next step once a real result comes back
  // with this flag on (see finalizeSceneVideoJob's docblock).
  if (endpoint === "bytedance/seedance-2-5") extra.return_last_frame = true;
  return extra;
}

/**
 * price_table's real `unit` column per video endpoint (spec §4: "Price
 * on every paid button, computed from the price table") — matches
 * supabase/seed_price_table.sql's actual rows exactly, not a single
 * invented unit applied to everything. kling-v2-1-pro/kling-v3-pro-i2v
 * (fal) have no price_table row at all yet (a pre-existing seed gap,
 * not introduced here) — defaulted to "per_video" so a price lookup
 * miss falls back to run-provider-job.ts's existing "$0 if the row is
 * missing" behavior rather than guessing a wrong unit.
 */
function priceUnitForVideoEndpoint(endpoint: string): "per_image" | "per_video" | "per_second" {
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

/** Server action wrapper so client components can compute the default duration without shipping lib/video/duration's pure logic into their own bundle unnecessarily — mirrors how other *-actions.ts files are the only server boundary client components cross. */
export async function computeDefaultDurationS(
  scene: { copy: string },
  speaks: boolean,
  parameterSchema: { key: string; type: string; options?: string[]; min?: number; max?: number }[]
): Promise<number> {
  const durationField = parseVideoDurationField(parameterSchema);
  return defaultSceneVideoDurationS({ wordCount: countWords(scene.copy), speaks, durationField });
}

/** Clamps an editor-chosen duration into the model's real range/enum before submitting — same function the default uses, exposed so the UI's slider can clamp on every change, not just at mount. */
export async function clampDurationS(
  raw: number,
  parameterSchema: { key: string; type: string; options?: string[]; min?: number; max?: number }[]
): Promise<number> {
  const durationField = parseVideoDurationField(parameterSchema);
  return clampToVideoDurationField(raw, durationField);
}

/** Saves the optional per-scene video idea text (spec §5.7). */
export async function saveVideoIdea(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  videoIdea: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("scenes")
    .update({ video_idea: videoIdea })
    .eq("org_id", orgId)
    .eq("id", sceneId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/** Saves the ad-level speaking rule (spec §5.4/§5.7). */
export async function saveSpeakingRule(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  speaking: AdBrief["speaking"]
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const ad = await getAd(orgId, productId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ brief: { ...ad.brief, speaking } })
    .eq("org_id", orgId)
    .eq("id", adId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Called by the polling UI once getJobStatus (re-exported below)
 * reports a generate_scene_video job as "succeeded" — downloads the
 * provider's result URL and re-uploads it into the `renders` bucket
 * as a new assets row, mirroring generate-reference-image.ts's
 * download-then-reupload pattern exactly (spec §5.9: "Nothing
 * generated is ever lost to provider URL expiry"). Idempotent against
 * being called twice for the same job: if an asset for this job
 * already exists (job.payload.savedAssetId set by a previous call),
 * it's returned as-is instead of uploading a duplicate.
 *
 * last_frame extraction (spec §5.7 "optional last_frame asset") is
 * still NOT implemented here, but no longer because it would need
 * ffmpeg — bytedance/seedance-2-5's real payload includes a
 * return_last_frame flag (now set in sceneVideoExtraParams for that
 * model), meaning kie.ai can hand back the last frame directly with
 * no video-processing dependency needed at all. What's actually
 * missing is the real RESPONSE shape when that flag is set (does it
 * add a field to resultJson, or come back as a second resultUrls
 * entry?) — not yet observed from a real result. Once one comes back,
 * read job.payload.raw (or re-poll and inspect KieAdapter's raw
 * response) to find the real field, then save it here as a second
 * assets row (kind='last_frame') alongside the video. Every other
 * provider/model still has no last-frame mechanism at all, so this
 * will likely stay seedance-2-5-specific for a while.
 */
export async function finalizeSceneVideoJob(orgId: string, jobId: string): Promise<ActionResult & { assetId?: string }> {
  await requireOrgMember(orgId);
  // jobs_select is ad-scoped: only finalize jobs on ads the caller can see.
  if (!(await canAccessJob(orgId, jobId))) return { ok: false, error: "Job not found." };

  const service = createServiceClient();
  const { data: job, error: jobError } = await service
    .from("jobs")
    .select("id, org_id, ad_id, scene_id, status, payload")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (jobError || !job) return { ok: false, error: jobError?.message ?? "Job not found." };
  if (job.status !== "succeeded") return { ok: false, error: "Job has not succeeded." };

  const payload = job.payload as { resultUrls?: string[]; savedAssetId?: string; endpoint?: string };
  if (payload.savedAssetId) {
    return { ok: true, assetId: payload.savedAssetId };
  }

  const resultUrl = payload.resultUrls?.[0];
  if (!resultUrl) return { ok: false, error: "Job succeeded but has no result URL." };
  if (!job.ad_id || !job.scene_id) return { ok: false, error: "Job is missing ad/scene association." };

  const videoRes = await fetch(resultUrl);
  if (!videoRes.ok) return { ok: false, error: "Could not download the generated video." };
  const videoBytes = await videoRes.arrayBuffer();

  const { data: existingVersions } = await service
    .from("assets")
    .select("version")
    .eq("org_id", orgId)
    .eq("scene_id", job.scene_id)
    .eq("kind", "video")
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existingVersions?.[0]?.version ?? 0) + 1;

  const storagePath = `${orgId}/renders/${job.ad_id}/${job.scene_id}/${Date.now()}.mp4`;
  const { error: uploadError } = await service.storage
    .from("renders")
    .upload(storagePath, videoBytes, { contentType: "video/mp4" });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: assetRow, error: assetError } = await service
    .from("assets")
    .insert({
      org_id: orgId,
      ad_id: job.ad_id,
      scene_id: job.scene_id,
      kind: "video",
      version: nextVersion,
      storage_path: storagePath,
      source: `${payload.endpoint ?? "unknown"}`,
    })
    .select("id")
    .single();
  if (assetError) return { ok: false, error: assetError.message };

  await service.from("jobs").update({ payload: { ...payload, savedAssetId: assetRow.id } }).eq("id", jobId);

  return { ok: true, assetId: assetRow.id };
}

/** Restores an archived video asset (spec §5.8: "an 'archived videos' strip lets the editor restore them"). */
export async function restoreArchivedVideo(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  assetId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const asset = await getAccessibleAsset(orgId, assetId);
  if (!asset || asset.ad_id !== adId) return { ok: false, error: "Video not found." };

  const service = createServiceClient();
  const { error } = await service.from("assets").update({ archived: false }).eq("id", assetId).eq("org_id", orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

// Re-exported so scene-videos-step.tsx only needs one import source
// for job-status polling, rather than importing lib/jobs/run-job.ts
// directly alongside this file.
export const getJobStatus = getJobStatusAction;

// Start/end frame mode and the scene-to-scene transition clip
// (spec §5.7: "Start and end frame mode for models that support it.
// Optional short transition clip between two scenes.") are both
// still deliberately NOT implemented — the transition clip remains an
// explicitly separate, skippable feature per this change's scope.
//
// UPDATE (2026-10-12): minimax-h3/image-to-video's real payload
// (user-confirmed) DOES support this — first_frame_url plus an
// optional last_frame_url — so "no model documents end-frame support"
// is no longer true. KieAdapter.submit() only maps the start frame
// (referenceImageUrls[0] -> first_frame_url) for now; wiring an
// actual end-frame picker into this file's generation flow (SubmitParams
// would need a second field, e.g. endFrameImageUrl, threaded through
// here and into the adapter) is real, scoped follow-up work, not done
// in this pass — revisit once the UI/UX for picking a second frame is
// designed, rather than bolting it on as an afterthought here.
