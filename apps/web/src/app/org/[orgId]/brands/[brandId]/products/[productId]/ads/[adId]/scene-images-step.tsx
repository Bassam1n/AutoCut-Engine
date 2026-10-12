"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AsyncButton } from "@/components/async-button";
import { ModelPicker } from "@/components/model-picker";
import { MediaLightbox } from "@/components/media-lightbox";
import {
  generateSceneImages,
  getScenesWithoutImages,
  saveImagePromptOverride,
  resolveFinalImagePrompt,
  reserveFeedbackImageUploadPath,
  recordFeedbackImage,
  type ModelChoice,
  type ReferenceTierLabel,
} from "../scene-images-actions";
import { submitImageFeedback } from "../feedback-actions";
import { SceneFeedbackPanel } from "./scene-feedback-panel";
import type { Ad } from "../ads-data";
import type { Scene } from "../scenes-data";
import type { SceneImageAsset } from "../scene-images-data";
import type { ModelOption } from "@/lib/providers/models-data";

const STAGGER_MS = 1000;

export function SceneImagesStep({
  orgId,
  brandId,
  productId,
  ad,
  scenes,
  imagesBySceneId,
  feedbackImagesBySceneId,
  imageUrls,
  imageModelOptions,
  providersWithKeys,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scenes: Scene[];
  imagesBySceneId: Record<string, SceneImageAsset[]>;
  feedbackImagesBySceneId: Record<string, SceneImageAsset[]>;
  imageUrls: Record<string, string>;
  imageModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  onContinue: () => void;
}) {
  const [imageModel, setImageModel] = useState<ModelOption | null>(imageModelOptions[0] ?? null);
  const [generatingSceneIds, setGeneratingSceneIds] = useState<Set<string>>(new Set());
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [isStaggering, setIsStaggering] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [omittedNotes, setOmittedNotes] = useState<Record<string, { tier: ReferenceTierLabel; count: number }[]>>({});
  const router = useRouter();

  const returnToPath = `/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`;

  function markGenerating(sceneId: string, isGenerating: boolean) {
    setGeneratingSceneIds((prev) => {
      const next = new Set(prev);
      if (isGenerating) next.add(sceneId);
      else next.delete(sceneId);
      return next;
    });
  }

  async function runGenerate(sceneId: string, count: number) {
    if (!imageModel) {
      setError({ friendly: "Pick an image model first." });
      return;
    }
    const model: ModelChoice = { provider: imageModel.provider as "fal" | "kie", endpoint: imageModel.endpoint };
    markGenerating(sceneId, true);
    try {
      const result = await generateSceneImages(orgId, brandId, productId, ad.id, sceneId, count, model);
      if (result.ok) {
        setOmittedNotes((prev) => ({ ...prev, [sceneId]: result.omitted }));
        router.refresh();
      } else {
        setError(friendlyGenerationError(sceneIndexLabel(scenes, sceneId), result.error));
      }
    } finally {
      markGenerating(sceneId, false);
    }
  }

  /**
   * Generate All — spec §5.6: "starts scenes about one second apart
   * and skips scenes that already have images or are generating."
   * Skip logic: scenes already holding a non-archived image are
   * fetched fresh from the server (getScenesWithoutImages) right
   * before staggering starts; "currently generating" is the client-
   * side generatingSceneIds set, checked again at each scene's own
   * turn in case something else started it in the meantime.
   */
  async function onGenerateAll(countPerScene: number) {
    setError(null);
    setIsStaggering(true);
    try {
      const eligibleIds = new Set(await getScenesWithoutImages(orgId, ad.id));
      const targets = scenes.filter((s) => eligibleIds.has(s.id) && !generatingSceneIds.has(s.id));
      await staggeredGenerate(targets.map((s) => s.id), countPerScene);
    } finally {
      setIsStaggering(false);
    }
  }

  async function onGenerateSelected(countPerScene: number) {
    setError(null);
    setIsStaggering(true);
    try {
      const targets = scenes.filter((s) => selectedSceneIds.has(s.id) && !generatingSceneIds.has(s.id));
      await staggeredGenerate(targets.map((s) => s.id), countPerScene);
    } finally {
      setIsStaggering(false);
    }
  }

  async function staggeredGenerate(sceneIds: string[], countPerScene: number) {
    for (let i = 0; i < sceneIds.length; i++) {
      if (i > 0) await sleep(STAGGER_MS);
      // Fire-and-continue: each scene's own card tracks its pending
      // state via generatingSceneIds, so the stagger loop doesn't
      // need to block on one scene's full generation before starting
      // the next one's timer.
      void runGenerate(sceneIds[i], countPerScene);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Scene images</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Generate 1 to 4 images per scene. Already-imaged or
            currently-generating scenes are skipped automatically.
          </p>
        </div>
      </div>

      {error && <FriendlyErrorNote error={error} />}

      {imageModelOptions.length > 0 && (
        <ModelPicker
          orgId={orgId}
          options={imageModelOptions}
          providersWithKeys={providersWithKeys}
          value={imageModel ? { provider: imageModel.provider, endpoint: imageModel.endpoint } : null}
          onChange={setImageModel}
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
            <SceneImageCard
              key={scene.id}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              scene={scene}
              images={imagesBySceneId[scene.id] ?? []}
              feedbackImages={feedbackImagesBySceneId[scene.id] ?? []}
              imageUrls={imageUrls}
              isGenerating={generatingSceneIds.has(scene.id)}
              isSelected={selectedSceneIds.has(scene.id)}
              onToggleSelected={() => toggleSelected(scene.id)}
              onGenerate={(count) => runGenerate(scene.id, count)}
              omitted={omittedNotes[scene.id] ?? []}
              feedbackModel={imageModel}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Continue to scene videos →
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
  onGenerateAll: (countPerScene: number) => void;
  onGenerateSelected: (countPerScene: number) => void;
}) {
  const [count, setCount] = useState(1);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background-raised/50 p-3">
      <CountStepper value={count} onChange={setCount} label="Images per scene" />
      <AsyncButton
        onClick={() => onGenerateAll(count)}
        isPending={isStaggering}
        pendingLabel="Starting..."
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Generate All
      </AsyncButton>
      <AsyncButton
        onClick={() => onGenerateSelected(count)}
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

function CountStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-medium text-foreground-muted">{label}</span>
      <div className="flex items-center overflow-hidden rounded-lg border border-border-strong">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
          className="px-2 py-1 text-foreground-muted hover:bg-border/40 disabled:opacity-40"
        >
          −
        </button>
        <span className="px-2 py-1 font-medium">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(4, value + 1))}
          disabled={value >= 4}
          className="px-2 py-1 text-foreground-muted hover:bg-border/40 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SceneImageCard({
  orgId,
  brandId,
  productId,
  ad,
  scene,
  images,
  feedbackImages,
  imageUrls,
  isGenerating,
  isSelected,
  onToggleSelected,
  onGenerate,
  omitted,
  feedbackModel,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  images: SceneImageAsset[];
  feedbackImages: SceneImageAsset[];
  imageUrls: Record<string, string>;
  isGenerating: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onGenerate: (count: number) => void;
  omitted: { tier: ReferenceTierLabel; count: number }[];
  feedbackModel: ModelOption | null;
}) {
  const [count, setCount] = useState(1);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const elapsedSeconds = useElapsedSeconds(isGenerating);
  // Mirrors scene.image_prompt_override, but updated directly by
  // PromptOverrideEditor's save/reset instead of waiting on a server
  // round-trip + revalidatePath to reflect back down through props —
  // that round-trip is what made a save feel like the whole page
  // reloaded (every other bit of local UI state resets when the
  // server component tree re-renders), and it also meant the "Prompt
  // overridden" badge could go true while the text actually shown
  // below it was still the untouched scene.visual, never the override
  // itself.
  const [override, setOverride] = useState(scene.image_prompt_override);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelected}
            className="h-4 w-4 rounded border-border-strong"
            aria-label={`Select scene ${scene.idx + 1} for Generate Selected`}
          />
          <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
          {override && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              Prompt overridden
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsPromptOpen((v) => !v)}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40"
        >
          {isPromptOpen ? "Hide prompt" : "Edit prompt"}
        </button>
      </div>

      <p className="text-xs text-foreground-muted">
        {override ? (
          <>
            <span className="font-medium text-accent">Using overridden prompt: </span>
            {override}
          </>
        ) : (
          scene.visual || "No visual yet."
        )}
      </p>

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((asset) => {
            const url = imageUrls[asset.storage_path];
            return url ? (
              <button
                key={asset.id}
                type="button"
                onClick={() => setLightboxUrl(url)}
                className="overflow-hidden rounded-lg transition-opacity hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Scene ${scene.idx + 1} image v${asset.version} — click to expand`}
                  className="aspect-square w-full object-cover"
                />
              </button>
            ) : (
              <div
                key={asset.id}
                className="flex aspect-square w-full items-center justify-center rounded-lg bg-border text-xs text-foreground-muted"
              >
                v{asset.version}
              </div>
            );
          })}
        </div>
      )}

      {feedbackImages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">Feedback images</span>
          <div className="flex flex-wrap gap-2">
            {feedbackImages.map((asset) => {
              const url = imageUrls[asset.storage_path];
              return url ? (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  className="overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Scene ${scene.idx + 1} attached feedback image — click to expand`}
                    className="h-16 w-16 object-cover"
                  />
                </button>
              ) : (
                <div
                  key={asset.id}
                  className="flex h-16 w-16 items-center justify-center rounded-lg bg-border text-xs text-foreground-muted"
                >
                  …
                </div>
              );
            })}
          </div>
        </div>
      )}

      {omitted.length > 0 && (
        <p className="text-xs text-foreground-muted/70">
          {omitted.map((o) => `${o.count} ${o.tier}${o.count > 1 ? "s" : ""}`).join(", ")} omitted (reference
          cap reached).
        </p>
      )}

      {isPromptOpen && (
        <PromptOverrideEditor
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          ad={ad}
          scene={scene}
          override={override}
          onOverrideSaved={setOverride}
        />
      )}

      <FeedbackUpload orgId={orgId} brandId={brandId} productId={productId} ad={ad} scene={scene} />

      {images.length > 0 && (
        <SceneFeedbackPanel
          orgId={orgId}
          adId={ad.id}
          sceneId={scene.id}
          allowReferenceAttachment
          onSubmit={({ mode, feedbackText, remember, attachedReferenceStoragePath }) => {
            if (!feedbackModel) {
              return Promise.resolve({ ok: false, error: "Pick an image model first." } as const);
            }
            const model: ModelChoice = { provider: feedbackModel.provider as "fal" | "kie", endpoint: feedbackModel.endpoint };
            return submitImageFeedback(
              orgId,
              brandId,
              productId,
              ad.id,
              scene.id,
              mode,
              feedbackText,
              remember,
              model,
              attachedReferenceStoragePath
            );
          }}
        />
      )}

      <div className="flex items-center gap-3">
        <CountStepper value={count} onChange={setCount} label="Count" />
        <AsyncButton
          onClick={() => onGenerate(count)}
          isPending={isGenerating}
          pendingLabel={`Generating... (${elapsedSeconds}s)`}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {images.length > 0 ? "Regenerate" : "Generate"}
        </AsyncButton>
      </div>

      {lightboxUrl && (
        <MediaLightbox
          kind="image"
          url={lightboxUrl}
          alt={`Scene ${scene.idx + 1} image`}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  );
}

function PromptOverrideEditor({
  orgId,
  brandId,
  productId,
  ad,
  scene,
  override,
  onOverrideSaved,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  override: string | null;
  onOverrideSaved: (override: string | null) => void;
}) {
  const [text, setText] = useState(override ?? "");
  const [isComputing, startComputing] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasComputed, setHasComputed] = useState(Boolean(override));

  function onComputePrompt() {
    setError(null);
    startComputing(async () => {
      const result = await resolveFinalImagePrompt(orgId, brandId, productId, scene);
      if (result.ok) {
        setText(result.prompt);
        setHasComputed(true);
      } else {
        setError(result.error);
      }
    });
  }

  function onSave() {
    setError(null);
    startSaving(async () => {
      const result = await saveImagePromptOverride(orgId, brandId, productId, ad.id, scene.id, text || null);
      if (result.ok) {
        onOverrideSaved(text || null);
      } else {
        setError(result.error);
      }
    });
  }

  function onReset() {
    setError(null);
    setText("");
    startSaving(async () => {
      const result = await saveImagePromptOverride(orgId, brandId, productId, ad.id, scene.id, null);
      if (result.ok) {
        onOverrideSaved(null);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">Final image prompt (sticky override)</label>
        {!hasComputed && (
          <button
            type="button"
            onClick={onComputePrompt}
            disabled={isComputing}
            className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
          >
            {isComputing ? "Computing..." : "Compute current prompt"}
          </button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Computed automatically at generation time unless you save an override here."
        className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
      />
      <div className="flex gap-2">
        <AsyncButton
          onClick={onSave}
          isPending={isSaving}
          pendingLabel="Saving..."
          disabled={!text.trim()}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40"
        >
          Save override
        </AsyncButton>
        {override && (
          <button
            type="button"
            onClick={onReset}
            disabled={isSaving}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
          >
            Reset
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function FeedbackUpload({
  orgId,
  brandId,
  productId,
  ad,
  scene,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const reserved = await reserveFeedbackImageUploadPath(orgId, ad.id, scene.id, file.name);
      if (!reserved.ok) {
        setError(reserved.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .upload(reserved.path, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const result = await recordFeedbackImage(orgId, brandId, productId, ad.id, scene.id, reserved.path);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.refresh();
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      <label
        className={`rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium ${
          isUploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-border/40"
        }`}
      >
        {isUploading ? "Uploading..." : "Attach feedback image"}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          disabled={isUploading}
          className="hidden"
        />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function sceneIndexLabel(scenes: Scene[], sceneId: string): number {
  const scene = scenes.find((s) => s.id === sceneId);
  return (scene?.idx ?? 0) + 1;
}

type FriendlyError = { friendly: string; detail?: string };

/**
 * generateSceneImages()'s error is often a raw provider message
 * passed through verbatim (e.g. kie.ai's own "This field is required"
 * with no field name) — accurate, but meaningless to an editor with
 * no API background. Wraps it in a plain-language line and keeps the
 * raw text available behind "show details" rather than translating
 * specific phrases: the exact set of kie.ai/fal.ai error strings isn't
 * documented anywhere confirmed for this app, so guessing a mapping
 * risks showing confidently wrong guidance instead of an honest "it
 * failed, here's exactly why" escape hatch.
 */
function friendlyGenerationError(sceneNumber: number, rawError: string): FriendlyError {
  return {
    friendly: `Scene ${sceneNumber}: image generation failed. Try a different model, or check the prompt for anything the model might be rejecting.`,
    detail: rawError,
  };
}

function FriendlyErrorNote({ error }: { error: FriendlyError }) {
  return (
    <div className="text-sm text-danger">
      <p>{error.friendly}</p>
      {error.detail && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-foreground-muted hover:text-foreground">
            Show technical details
          </summary>
          <p className="mt-1 text-foreground-muted">{error.detail}</p>
        </details>
      )}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generation can legitimately take up to ~2 minutes (slower models,
 * refill rounds) — without this, a slow-but-working run looks
 * identical to a stuck one, which is exactly what prompts an editor
 * to hit Generate again mid-flight. Ticks every second while pending.
 */
function useElapsedSeconds(isPending: boolean): number {
  // Counts seconds in a local variable closed over by the interval,
  // only ever calling setState from inside the tick callback — never
  // synchronously at effect-entry, which is what the set-state-in-
  // effect lint rule flags as a cascading-render risk. This also gets
  // a correct reset for free: a fresh `count` starts at 0 each time
  // the effect re-runs for a new isPending transition.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isPending) return;
    let count = 0;
    const interval = setInterval(() => {
      count += 1;
      setElapsed(count);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPending]);

  return isPending ? elapsed : 0;
}
