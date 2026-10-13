"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncButton } from "@/components/async-button";
import { ModelPicker } from "@/components/model-picker";
import { MediaLightbox } from "@/components/media-lightbox";
import {
  generateSceneVideo,
  generateSceneVideoWithFallbackMotion,
  finalizeSceneVideoJob,
  getJobStatus,
  restoreArchivedVideo,
  saveVideoIdea,
  saveSpeakingRule,
  computeDefaultDurationS,
  clampDurationS,
} from "../scene-videos-actions";
import type { ModelChoice } from "../scene-videos-actions";
import { submitVideoFeedback } from "../feedback-actions";
import { SceneFeedbackPanel } from "./scene-feedback-panel";
import { saveToLibrary } from "@/app/org/[orgId]/library/library-actions";
import type { Ad, AdBrief } from "../ads-data";
import type { Scene } from "../scenes-data";
import type { SceneImageAsset } from "../scene-images-data";
import type { SceneVideoJob } from "../scene-videos-data";
import type { ModelOption } from "@/lib/providers/models-data";

const POLL_INTERVAL_MS = 4000; // Video jobs can run minutes-long (spec §5.7: up to ~20 minutes) — a few-second interval is frequent enough to feel responsive without hammering the DB, same order of magnitude as run-provider-job.ts's own 4s poll delay against the provider.
const STAGGER_MS = 1000; // Same stagger scene-images-step.tsx uses for its own Generate All — starts jobs about a second apart rather than all at once.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scene videos Studio step (spec §5.7). Per scene: pick a generated
 * image to animate, optional video idea, duration slider driven by
 * the selected model's real parameter_schema, a Generate button that
 * runs the motion preflight before any paid call, and an archived-
 * videos strip (spec §5.8) with per-video restore.
 *
 * Job persistence: `activeJobsBySceneId` comes from the server
 * (scene-videos-data.ts's getActiveSceneVideoJobs, which reads the
 * jobs table directly) rather than any client-only "is generating"
 * flag — on mount, any scene with a queued/running job resumes
 * polling immediately, so a page reload mid-generation never loses
 * track of an in-flight ~20-minute job (spec: "survive tab closes and
 * reloads").
 */
export function SceneVideosStep({
  orgId,
  brandId,
  productId,
  ad,
  scenes,
  imagesBySceneId,
  videosBySceneId,
  archivedVideosBySceneId,
  activeJobsBySceneId,
  assetUrls,
  videoModelOptions,
  providersWithKeys,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scenes: Scene[];
  imagesBySceneId: Record<string, SceneImageAsset[]>;
  videosBySceneId: Record<string, SceneImageAsset[]>;
  archivedVideosBySceneId: Record<string, SceneImageAsset[]>;
  activeJobsBySceneId: Record<string, SceneVideoJob>;
  assetUrls: Record<string, string>;
  videoModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  onContinue: () => void;
}) {
  const [videoModel, setVideoModel] = useState<ModelOption | null>(videoModelOptions[0] ?? null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [isStaggering, setIsStaggering] = useState(false);
  const returnToPath = `/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`;

  // Bulk generation (user feedback: scene videos is the single biggest
  // wait in the whole pipeline — ~20 min jobs clicked one scene at a
  // time — same staggered "Generate All" pattern scene-images-step.tsx
  // already proved). Each card registers its own onGenerate closure
  // here; a scene whose motion preflight stops just shows its existing
  // stop-message card as normal (user-confirmed: don't block the rest
  // of the batch on one scene needing a manual "Animate this instead"
  // decision).
  const triggersRef = useRef<Map<string, () => void>>(new Map());
  function registerTrigger(sceneId: string, trigger: () => void) {
    triggersRef.current.set(sceneId, trigger);
  }

  function eligibleSceneIds(): string[] {
    return scenes
      .filter((s) => {
        const hasImage = (imagesBySceneId[s.id] ?? []).length > 0;
        const hasVideo = (videosBySceneId[s.id] ?? []).length > 0;
        const isActive = Boolean(activeJobsBySceneId[s.id]);
        return hasImage && !hasVideo && !isActive;
      })
      .map((s) => s.id);
  }

  async function staggeredGenerate(sceneIds: string[]) {
    for (let i = 0; i < sceneIds.length; i++) {
      if (i > 0) await sleep(STAGGER_MS);
      triggersRef.current.get(sceneIds[i])?.();
    }
  }

  async function onGenerateAll() {
    setIsStaggering(true);
    try {
      await staggeredGenerate(eligibleSceneIds());
    } finally {
      setIsStaggering(false);
    }
  }

  async function onGenerateSelected() {
    setIsStaggering(true);
    try {
      const eligible = new Set(eligibleSceneIds());
      await staggeredGenerate(scenes.filter((s) => selectedSceneIds.has(s.id) && eligible.has(s.id)).map((s) => s.id));
    } finally {
      setIsStaggering(false);
    }
  }

  function toggleSelected(sceneId: string) {
    setSelectedSceneIds((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Scene videos</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Animate a generated image into a short clip per scene. Every
          generation is checked first for whether the motion actually
          makes sense from that image.
        </p>
      </div>

      <SpeakingRuleControl orgId={orgId} brandId={brandId} productId={productId} ad={ad} />

      {videoModelOptions.length > 0 && (
        <ModelPicker
          orgId={orgId}
          options={videoModelOptions}
          providersWithKeys={providersWithKeys}
          value={videoModel ? { provider: videoModel.provider, endpoint: videoModel.endpoint } : null}
          onChange={setVideoModel}
          returnToPath={returnToPath}
        />
      )}

      <GenerateAllBar
        isStaggering={isStaggering}
        selectedCount={selectedSceneIds.size}
        onGenerateAll={onGenerateAll}
        onGenerateSelected={onGenerateSelected}
      />

      {scenes.length === 0 ? (
        <p className="text-sm text-foreground-muted">No scenes yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {scenes.map((scene) => (
            <SceneVideoCard
              key={scene.id}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              scene={scene}
              images={imagesBySceneId[scene.id] ?? []}
              videos={videosBySceneId[scene.id] ?? []}
              archivedVideos={archivedVideosBySceneId[scene.id] ?? []}
              activeJob={activeJobsBySceneId[scene.id] ?? null}
              assetUrls={assetUrls}
              videoModel={videoModel}
              onRegisterTrigger={registerTrigger}
              isSelected={selectedSceneIds.has(scene.id)}
              onToggleSelected={() => toggleSelected(scene.id)}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Continue to Export
        </button>
      </div>
    </div>
  );
}

function GenerateAllBar({
  isStaggering,
  selectedCount,
  onGenerateAll,
  onGenerateSelected,
}: {
  isStaggering: boolean;
  selectedCount: number;
  onGenerateAll: () => void;
  onGenerateSelected: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background-raised/50 p-3">
      <span className="text-xs text-foreground-muted">
        Starts eligible scenes (has an image, no video yet, not already generating) about a
        second apart.
      </span>
      <AsyncButton
        onClick={onGenerateAll}
        isPending={isStaggering}
        pendingLabel="Starting..."
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Generate All
      </AsyncButton>
      <AsyncButton
        onClick={onGenerateSelected}
        isPending={isStaggering}
        disabled={selectedCount === 0}
        pendingLabel="Starting..."
        className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40"
      >
        Generate Selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </AsyncButton>
    </div>
  );
}

const SPEAKING_OPTIONS: { value: NonNullable<AdBrief["speaking"]>; label: string }[] = [
  { value: "everyone", label: "Everyone speaks" },
  { value: "nobody", label: "Nobody speaks" },
  { value: "some_scenes", label: "Only some scenes" },
];

/**
 * Speaking-field UI placement — a real judgment call. Spec §5.4 names
 * "whether anyone speaks on camera" as part of Dial-in's ad-topic
 * questions, but it's placed here, on the Scene videos step itself,
 * rather than inside dial-in-step.tsx: this app's existing Dial-in
 * flow folds every ad-topic answer into free-text brief.idea (ADR 002
 * item 29, deliberate at the time since nothing downstream read a
 * structured field yet), and Scene videos is the FIRST and ONLY
 * consumer of this field — the hard "nobody never gets copy in the
 * prompt" rule lives entirely in scene-videos-actions.ts. Putting the
 * control immediately above the step that enforces it keeps the rule
 * and its one UI visible together, rather than splitting a brand-new
 * structured brief field across two steps built in different
 * milestones. Revisit if a future pass wants it surfaced earlier in
 * Dial-in too.
 */
function SpeakingRuleControl({
  orgId,
  brandId,
  productId,
  ad,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
}) {
  const [speaking, setSpeaking] = useState<AdBrief["speaking"]>(ad.brief.speaking);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(value: NonNullable<AdBrief["speaking"]>) {
    setSpeaking(value);
    setIsSaving(true);
    setError(null);
    try {
      const result = await saveSpeakingRule(orgId, brandId, productId, ad.id, value);
      if (!result.ok) setError(result.error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <label className="text-xs font-medium">Who speaks on camera?</label>
      <p className="text-xs text-foreground-muted">
        Controls whether scene copy is allowed into video prompts.
        &quot;Only some scenes&quot; follows each scene&apos;s own speaker field.
      </p>
      <div className="flex flex-wrap gap-2">
        {SPEAKING_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={isSaving}
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              speaking === opt.value
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-strong hover:bg-border/40"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function SceneVideoCard({
  orgId,
  brandId,
  productId,
  ad,
  scene,
  images,
  videos,
  archivedVideos,
  activeJob,
  assetUrls,
  videoModel,
  onRegisterTrigger,
  isSelected,
  onToggleSelected,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  images: SceneImageAsset[];
  videos: SceneImageAsset[];
  archivedVideos: SceneImageAsset[];
  activeJob: SceneVideoJob | null;
  assetUrls: Record<string, string>;
  videoModel: ModelOption | null;
  /** Registers this card's onGenerate so "Generate All"/"Generate Selected" (parent-level, staggered) can trigger it without lifting this card's entire generation state up — same pattern scene-images-step.tsx avoids by keeping per-scene state local and only exposing the one callback a bulk action needs. */
  onRegisterTrigger?: (sceneId: string, trigger: () => void) => void;
  isSelected?: boolean;
  onToggleSelected?: () => void;
}) {
  const router = useRouter();
  const [selectedImageId, setSelectedImageId] = useState<string | null>(images[images.length - 1]?.id ?? null);
  const [lightbox, setLightbox] = useState<{ kind: "image" | "video"; url: string } | null>(null);
  const [videoIdea, setVideoIdea] = useState(scene.video_idea ?? "");
  const [duration, setDuration] = useState<number>(4);
  const [durationBounds, setDurationBounds] = useState<{ min: number; max: number; step: number } | null>(null);
  const [isGenerating, setIsGenerating] = useState(Boolean(activeJob));
  const [isAnimatingFallback, setIsAnimatingFallback] = useState(false);
  const [stopMessage, setStopMessage] = useState<{ reason: string; fallback: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trimmedNote, setTrimmedNote] = useState<string | null>(null);
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(activeJob?.id ?? null);

  async function onSaveToLibrary(assetId: string) {
    setSavingAssetId(assetId);
    try {
      await saveToLibrary(orgId, assetId, brandId);
    } finally {
      setSavingAssetId(null);
    }
  }

  // Recomputes the duration slider's bounds and default whenever the
  // selected video model changes — driven by that model's real
  // parameter_schema duration field (enum options or integer min/max),
  // never hardcoded. Speaking is resolved server-side too (brief rule
  // + scene.speaker), so this only needs scene.copy's presence as a
  // quick client-side guess for setting a sane initial slider value;
  // the server re-resolves the real speaking rule at generate time
  // regardless.
  useEffect(() => {
    if (!videoModel) return;
    const guessSpeaks = scene.copy.trim().length > 0;
    let cancelled = false;
    (async () => {
      const def = await computeDefaultDurationS(scene, guessSpeaks, videoModel.parameterSchema);
      if (cancelled) return;
      setDuration(def);
      const durationField = videoModel.parameterSchema.find((f) => f.key === "duration");
      if (durationField?.type === "enum" && durationField.options?.length) {
        const nums = durationField.options.map(Number).filter((n) => !Number.isNaN(n));
        setDurationBounds({ min: Math.min(...nums), max: Math.max(...nums), step: 1 });
      } else if (typeof durationField?.min === "number" && typeof durationField?.max === "number") {
        setDurationBounds({ min: durationField.min, max: durationField.max, step: 1 });
      } else {
        setDurationBounds(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs on model change only; scene is stable for the lifetime of this card
  }, [videoModel]);

  // Resume polling on mount if an active job already exists for this
  // scene (spec §5.7: jobs "survive tab closes and reloads") — the
  // jobs table, read server-side into activeJob, is the sole source
  // of truth for "is this scene generating," never a client flag that
  // resets on reload.
  useEffect(() => {
    if (!activeJob) return;
    // isGenerating already started true for this card (seeded from
    // Boolean(activeJob) in useState above) — no setState needed here,
    // just arming the poll loop against the job that's already known.
    jobIdRef.current = activeJob.id;
    const interval = setInterval(async () => {
      const jobId = jobIdRef.current;
      if (!jobId) return;
      const status = await getJobStatus(orgId, jobId);
      if (!status.ok) return;
      if (status.status === "succeeded") {
        clearInterval(interval);
        await finalizeSceneVideoJob(orgId, jobId);
        setIsGenerating(false);
        jobIdRef.current = null;
        router.refresh();
      } else if (status.status === "failed" || status.status === "cancelled") {
        clearInterval(interval);
        setIsGenerating(false);
        jobIdRef.current = null;
        setError(status.error ?? "Video generation failed.");
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeJob.id only changes on a fresh mount/reload, which is exactly when this should re-arm
  }, [activeJob?.id]);

  function pollJob(jobId: string) {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    const interval = setInterval(async () => {
      const currentJobId = jobIdRef.current;
      if (!currentJobId) {
        clearInterval(interval);
        return;
      }
      const status = await getJobStatus(orgId, currentJobId);
      if (!status.ok) return;
      if (status.status === "succeeded") {
        clearInterval(interval);
        await finalizeSceneVideoJob(orgId, currentJobId);
        setIsGenerating(false);
        jobIdRef.current = null;
        router.refresh();
      } else if (status.status === "failed" || status.status === "cancelled") {
        clearInterval(interval);
        setIsGenerating(false);
        jobIdRef.current = null;
        setError(status.error ?? "Video generation failed.");
      }
    }, POLL_INTERVAL_MS);
  }

  function resolveSelectedImage(): { id: string; url: string } | null {
    const image = images.find((i) => i.id === selectedImageId);
    const url = image ? assetUrls[image.storage_path] : null;
    return image && url ? { id: image.id, url } : null;
  }

  async function onGenerate() {
    setError(null);
    setStopMessage(null);
    setTrimmedNote(null);

    if (!videoModel) {
      setError("Pick a video model first.");
      return;
    }
    const image = resolveSelectedImage();
    if (!image) {
      setError("Pick a generated image to animate first.");
      return;
    }

    const clampedDuration = await clampDurationS(duration, videoModel.parameterSchema);
    const model: ModelChoice = { provider: videoModel.provider as "fal" | "kie", endpoint: videoModel.endpoint };

    setIsGenerating(true);
    try {
      const result = await generateSceneVideo(
        orgId,
        brandId,
        productId,
        ad.id,
        scene.id,
        image.id,
        image.url,
        clampedDuration,
        model
      );

      if (result.ok) {
        if (result.trimmedNote) setTrimmedNote(result.trimmedNote);
        pollJob(result.jobId);
        return; // isGenerating stays true; pollJob's interval will flip it off
      }

      setIsGenerating(false);
      if (result.stoppedAtPreflight) {
        setStopMessage({ reason: result.error, fallback: result.fallbackMotionPlan ?? null });
      } else {
        setError(result.error);
      }
    } catch (err) {
      setIsGenerating(false);
      setError(err instanceof Error ? err.message : "Video generation failed.");
    }
  }

  // Exposes this card's onGenerate to the parent's "Generate All"/
  // "Generate Selected" bulk actions — re-registers whenever
  // onGenerate's own closure changes (selectedImageId/duration/
  // videoModel) so a bulk trigger always calls the current version,
  // never a stale one captured on first mount.
  useEffect(() => {
    onRegisterTrigger?.(scene.id, onGenerate);
  });

  /**
   * "Animate this instead" — spec §5.7's "offer to animate what the
   * moment can still do," accepted explicitly by the editor rather
   * than auto-applied. Keeps the stop-message card (and this button)
   * visible with its own pending state while the request is in
   * flight — clearing it immediately on click made the whole card
   * vanish with no visible feedback, which read as the click doing
   * nothing.
   */
  async function onAnimateFallback(fallbackMotionPlan: string) {
    if (!videoModel) return;
    const image = resolveSelectedImage();
    if (!image) return;

    setError(null);
    const clampedDuration = await clampDurationS(duration, videoModel.parameterSchema);
    const model: ModelChoice = { provider: videoModel.provider as "fal" | "kie", endpoint: videoModel.endpoint };

    setIsAnimatingFallback(true);
    setIsGenerating(true);
    try {
      const result = await generateSceneVideoWithFallbackMotion(
        orgId,
        brandId,
        productId,
        ad.id,
        scene.id,
        image.id,
        image.url,
        clampedDuration,
        model,
        fallbackMotionPlan
      );
      if (result.ok) {
        setStopMessage(null);
        if (result.trimmedNote) setTrimmedNote(result.trimmedNote);
        pollJob(result.jobId);
        return;
      }
      setIsGenerating(false);
      setError(result.error);
    } catch (err) {
      setIsGenerating(false);
      setError(err instanceof Error ? err.message : "Video generation failed.");
    } finally {
      setIsAnimatingFallback(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          {onToggleSelected && (
            <input
              type="checkbox"
              checked={Boolean(isSelected)}
              onChange={onToggleSelected}
              className="h-3.5 w-3.5 accent-accent"
              aria-label={`Select scene ${scene.idx + 1} for bulk generation`}
            />
          )}
          Scene {scene.idx + 1}
        </span>
      </div>

      <p className="text-xs text-foreground-muted">{scene.visual || "No visual yet."}</p>

      {images.length === 0 ? (
        <p className="text-xs text-foreground-muted/70">
          Generate a scene image first — Scene videos animates an existing image.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {images.length > 1 && (
            <span className="text-xs text-foreground-muted">
              {images.length} images — pick which one to animate:
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            {images.map((asset) => {
              const url = assetUrls[asset.storage_path];
              const isSelected = asset.id === selectedImageId;
              return (
                <div key={asset.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedImageId(asset.id)}
                    className={`overflow-hidden rounded-lg border-2 transition-colors ${
                      isSelected ? "border-accent" : "border-transparent hover:border-border-strong"
                    }`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={`Scene ${scene.idx + 1} image v${asset.version}`} className="h-20 w-20 object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center bg-border text-xs text-foreground-muted">
                        v{asset.version}
                      </div>
                    )}
                  </button>
                  {isSelected && (
                    <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-accent-ink">
                      ✓
                    </span>
                  )}
                  {url && (
                    <button
                      type="button"
                      onClick={() => setLightbox({ kind: "image", url })}
                      title="Expand to review"
                      className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-[10px] text-white hover:bg-black/80"
                    >
                      ⤢
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">Videos</span>
          <div className="flex flex-wrap gap-2">
            {videos.map((asset) => {
              const url = assetUrls[asset.storage_path];
              return url ? (
                <div key={asset.id} className="relative">
                  <video src={url} controls className="h-28 w-48 rounded-lg bg-black object-cover" />
                  <button
                    type="button"
                    onClick={() => setLightbox({ kind: "video", url })}
                    title="Expand to review"
                    className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-[10px] text-white hover:bg-black/80"
                  >
                    ⤢
                  </button>
                  <button
                    type="button"
                    onClick={() => onSaveToLibrary(asset.id)}
                    disabled={savingAssetId === asset.id}
                    title="Save to library"
                    className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80 disabled:opacity-60"
                  >
                    {savingAssetId === asset.id ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : (
                <div key={asset.id} className="flex h-28 w-48 items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
                  v{asset.version}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <SceneFeedbackPanel
          orgId={orgId}
          adId={ad.id}
          sceneId={scene.id}
          allowReferenceAttachment={false}
          onSubmit={({ mode, feedbackText, remember }) => {
            if (!videoModel) {
              return Promise.resolve({ ok: false, error: "Pick a video model first." } as const);
            }
            const model: ModelChoice = { provider: videoModel.provider as "fal" | "kie", endpoint: videoModel.endpoint };
            return submitVideoFeedback(orgId, brandId, productId, ad.id, scene.id, mode, feedbackText, remember, model);
          }}
          onVideoJobStarted={(jobId) => pollJob(jobId)}
        />
      )}

      {archivedVideos.length > 0 && (
        <ArchivedVideosStrip
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          adId={ad.id}
          scene={scene}
          archivedVideos={archivedVideos}
          assetUrls={assetUrls}
        />
      )}

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <label className="text-xs font-medium">Video idea (optional)</label>
        <VideoIdeaEditor
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          adId={ad.id}
          sceneId={scene.id}
          value={videoIdea}
          onChange={setVideoIdea}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-3">
        <label className="text-xs font-medium">Duration</label>
        <input
          type="range"
          min={durationBounds?.min ?? 1}
          max={durationBounds?.max ?? 15}
          step={durationBounds?.step ?? 1}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-10 text-right text-xs font-medium">{Math.round(duration)}s</span>
      </div>

      {trimmedNote && <p className="text-xs text-accent">{trimmedNote}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}

      {stopMessage && (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="text-xs text-danger">{stopMessage.reason}</p>
          {stopMessage.fallback && (
            <AsyncButton
              onClick={() => onAnimateFallback(stopMessage.fallback as string)}
              isPending={isAnimatingFallback}
              pendingLabel="Starting..."
              className="self-start rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40"
            >
              Animate this instead
            </AsyncButton>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <AsyncButton
          onClick={onGenerate}
          isPending={isGenerating}
          pendingLabel="Generating... (this can take a while)"
          disabled={images.length === 0}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {videos.length > 0 ? "Regenerate" : "Generate"}
        </AsyncButton>
      </div>

      {lightbox && (
        <MediaLightbox
          kind={lightbox.kind}
          url={lightbox.url}
          alt={`Scene ${scene.idx + 1} ${lightbox.kind}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function VideoIdeaEditor({
  orgId,
  brandId,
  productId,
  adId,
  sceneId,
  value,
  onChange,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  adId: string;
  sceneId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);

  async function onBlur() {
    setIsSaving(true);
    try {
      await saveVideoIdea(orgId, brandId, productId, adId, sceneId, value.trim() || null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={2}
      disabled={isSaving}
      placeholder="e.g. 'she turns the bottle to show the label' — leave blank to let the motion preflight decide from the scene's visual"
      className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
    />
  );
}

function ArchivedVideosStrip({
  orgId,
  brandId,
  productId,
  adId,
  scene,
  archivedVideos,
  assetUrls,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  adId: string;
  scene: Scene;
  archivedVideos: SceneImageAsset[];
  assetUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function onRestore(assetId: string) {
    setRestoringId(assetId);
    try {
      const result = await restoreArchivedVideo(orgId, brandId, productId, adId, assetId);
      if (result.ok) router.refresh();
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-foreground-muted">
        Archived videos — archived when scene {scene.idx + 1}&apos;s image was regenerated
      </span>
      <div className="flex flex-wrap gap-2">
        {archivedVideos.map((asset) => {
          const url = assetUrls[asset.storage_path];
          return (
            <div key={asset.id} className="flex flex-col gap-1">
              {url ? (
                <video src={url} controls className="h-20 w-36 rounded-lg bg-black object-cover opacity-70" />
              ) : (
                <div className="flex h-20 w-36 items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
                  v{asset.version}
                </div>
              )}
              <button
                type="button"
                onClick={() => onRestore(asset.id)}
                disabled={restoringId === asset.id}
                className="rounded-lg border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
              >
                {restoringId === asset.id ? "Restoring..." : "Restore"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
