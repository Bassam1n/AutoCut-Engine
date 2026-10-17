"use client";

import { SceneStylePicker } from "./scene-style-picker";
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
  restoreArchivedImage,
  type ModelChoice,
  type ReferenceTierLabel,
} from "../scene-images-actions";
import { submitImageFeedback } from "../feedback-actions";
import { SceneFeedbackPanel } from "./scene-feedback-panel";
import { SceneImageChat } from "./scene-image-chat";
import { LibraryPanel, LIBRARY_ASSET_DRAG_TYPE } from "./library-panel";
import { saveToLibrary, addLibraryItemToScene } from "@/app/org/[orgId]/library/library-actions";
import type { Ad } from "../ads-data";
import type { Scene } from "../scenes-data";
import type { SceneImageAsset } from "../scene-images-data";
import type { ModelOption } from "@/lib/providers/models-data";
import type { SceneSpendTotal } from "../spend-data";
import { buttonVariants } from "@/components/button";

const STAGGER_MS = 1000;

export function SceneImagesStep({
  orgId,
  brandId,
  productId,
  ad,
  scenes,
  imagesBySceneId,
  archivedImagesBySceneId,
  feedbackImagesBySceneId,
  imageUrls,
  imageModelOptions,
  providersWithKeys,
  sceneSpendBySceneId,
  revisionNotes,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scenes: Scene[];
  imagesBySceneId: Record<string, SceneImageAsset[]>;
  archivedImagesBySceneId: Record<string, SceneImageAsset[]>;
  feedbackImagesBySceneId: Record<string, SceneImageAsset[]>;
  imageUrls: Record<string, string>;
  imageModelOptions: ModelOption[];
  providersWithKeys: Set<string>;
  sceneSpendBySceneId?: Record<string, SceneSpendTotal>;
  /** scene_id -> reviewer's requested change, from the latest review round. */
  revisionNotes: Record<string, string>;
  onContinue: () => void;
}) {
  const [imageModel, setImageModel] = useState<ModelOption | null>(imageModelOptions[0] ?? null);
  const [generatingSceneIds, setGeneratingSceneIds] = useState<Set<string>>(new Set());
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [isStaggering, setIsStaggering] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [omittedNotes, setOmittedNotes] = useState<Record<string, { tier: ReferenceTierLabel; count: number }[]>>({});
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const router = useRouter();

  const returnToPath = `/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`;

  async function onDropLibraryAsset(sceneId: string, assetId: string) {
    const result = await addLibraryItemToScene(orgId, ad.id, sceneId, assetId);
    if (!result.ok) {
      setError({ friendly: `Could not add that library image to scene ${sceneIndexLabel(scenes, sceneId)}.`, detail: result.error });
    } else {
      router.refresh();
    }
  }

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
    const model: ModelChoice = { provider: imageModel.provider as "fal" | "kie" | "higgsfield_plan", endpoint: imageModel.endpoint };
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
        <button
          type="button"
          onClick={() => setIsLibraryOpen((v) => !v)}
          className="btn-secondary btn-sm shrink-0"
        >
          {isLibraryOpen ? "Hide library" : "Browse library"}
        </button>
      </div>

      <LibraryPanel orgId={orgId} isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} />

      {error && <FriendlyErrorNote error={error} />}

      {imageModelOptions.length > 0 && (
        <ModelPicker
          orgId={orgId}
          brandId={brandId}
          options={imageModelOptions}
          providersWithKeys={providersWithKeys}
          value={imageModel ? { provider: imageModel.provider, endpoint: imageModel.endpoint } : null}
          onChange={setImageModel}
          returnToPath={returnToPath}
        />
      )}

      <SceneImageChat orgId={orgId} brandId={brandId} productId={productId} adId={ad.id} />

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
              // Re-keyed on the override so a prompt written by the
              // chat (server side) replaces the card's local copy.
              key={`${scene.id}:${scene.image_prompt_override ?? ""}`}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              scene={scene}
              images={imagesBySceneId[scene.id] ?? []}
              archivedImages={archivedImagesBySceneId[scene.id] ?? []}
              feedbackImages={feedbackImagesBySceneId[scene.id] ?? []}
              imageUrls={imageUrls}
              spend={sceneSpendBySceneId?.[scene.id]}
              isGenerating={generatingSceneIds.has(scene.id)}
              isSelected={selectedSceneIds.has(scene.id)}
              onToggleSelected={() => toggleSelected(scene.id)}
              onGenerate={(count) => runGenerate(scene.id, count)}
              omitted={omittedNotes[scene.id] ?? []}
              feedbackModel={imageModel}
              onDropLibraryAsset={(assetId) => onDropLibraryAsset(scene.id, assetId)}
              revisionNote={revisionNotes[scene.id]}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className={buttonVariants.primary}
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
    <div className="card-inset flex flex-wrap items-center gap-3 p-3">
      <CountStepper value={count} onChange={setCount} label="Images per scene" />
      <AsyncButton
        onClick={() => onGenerateAll(count)}
        isPending={isStaggering}
        pendingLabel="Starting..."
        className="btn-primary btn-sm"
      >
        Generate All
      </AsyncButton>
      <AsyncButton
        onClick={() => onGenerateSelected(count)}
        isPending={isStaggering}
        disabled={selectedCount === 0}
        pendingLabel="Starting..."
        className="btn-secondary btn-sm"
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
      <div className="flex items-center overflow-hidden rounded-full border border-border-strong bg-background-raised shadow-soft">
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
  archivedImages,
  feedbackImages,
  imageUrls,
  spend,
  isGenerating,
  isSelected,
  onToggleSelected,
  onGenerate,
  omitted,
  feedbackModel,
  onDropLibraryAsset,
  revisionNote,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  images: SceneImageAsset[];
  archivedImages: SceneImageAsset[];
  feedbackImages: SceneImageAsset[];
  imageUrls: Record<string, string>;
  spend?: SceneSpendTotal;
  isGenerating: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onGenerate: (count: number) => void;
  omitted: { tier: ReferenceTierLabel; count: number }[];
  feedbackModel: ModelOption | null;
  /** Spec §5.9: "Drag a library item into a scene" — called with the dropped library item's underlying asset id. */
  onDropLibraryAsset: (assetId: string) => void;
  revisionNote?: string;
}) {
  const [count, setCount] = useState(1);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);
  const elapsedSeconds = useElapsedSeconds(isGenerating);

  async function onSaveToLibrary(assetId: string) {
    setSavingAssetId(assetId);
    try {
      await saveToLibrary(orgId, assetId, brandId);
    } finally {
      setSavingAssetId(null);
    }
  }
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
    <div className={`card-inset flex flex-col gap-3 p-4 ${revisionNote ? "border-danger/50" : ""}`}>
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
          <SceneStylePicker key={scene.style_id ?? "ad"} sceneId={scene.id} styleId={scene.style_id} />
          {spend && spend.usd > 0 && (
            <span
              title={`${spend.count} generation${spend.count === 1 ? "" : "s"}`}
              className="rounded-full bg-border/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted"
            >
              ${spend.usd.toFixed(2)}
            </span>
          )}
          {override && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              Prompt overridden
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsPromptOpen((v) => !v)}
          className="btn-secondary btn-sm"
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

      {/*
       * Drop target for "drag a library item into a scene" (spec
       * §5.9) — wraps the whole image grid (not each individual
       * thumbnail) since dropping onto a scene with zero images yet
       * must still work, and onDragOver's preventDefault() is what
       * tells the browser this element accepts a drop at all.
       */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(LIBRARY_ASSET_DRAG_TYPE)) {
            e.preventDefault();
            setIsDragOver(true);
          }
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const assetId = e.dataTransfer.getData(LIBRARY_ASSET_DRAG_TYPE);
          if (assetId) onDropLibraryAsset(assetId);
        }}
        className={`rounded-lg transition-colors ${isDragOver ? "ring-2 ring-accent" : ""}`}
      >
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {images.map((asset) => {
              const url = imageUrls[asset.storage_path];
              return (
                <div key={asset.id} className="relative">
                  {url ? (
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(url)}
                      className="block w-full overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Scene ${scene.idx + 1} image v${asset.version} — click to expand`}
                        className="aspect-square w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
                      v{asset.version}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onSaveToLibrary(asset.id)}
                    disabled={savingAssetId === asset.id}
                    title="Save to library"
                    className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80 disabled:opacity-60"
                  >
                    {savingAssetId === asset.id ? "Saving..." : "Save"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-xs text-foreground-muted">
            Drop a library image here to use it for this scene.
          </p>
        )}
      </div>

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
          model={feedbackModel ? { provider: feedbackModel.provider as "fal" | "kie" | "higgsfield_plan", endpoint: feedbackModel.endpoint } : null}
        />
      )}

      {revisionNote && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="font-semibold">Reviewer:</span> {revisionNote}
        </p>
      )}
      <FeedbackUpload orgId={orgId} brandId={brandId} productId={productId} ad={ad} scene={scene} />

      {images.length > 0 && (
        <SceneFeedbackPanel
          orgId={orgId}
          adId={ad.id}
          sceneId={scene.id}
          initialFeedbackText={revisionNote}
          allowReferenceAttachment
          onSubmit={({ mode, feedbackText, remember, attachedReferenceStoragePath }) => {
            if (!feedbackModel) {
              return Promise.resolve({ ok: false, error: "Pick an image model first." } as const);
            }
            const model: ModelChoice = { provider: feedbackModel.provider as "fal" | "kie" | "higgsfield_plan", endpoint: feedbackModel.endpoint };
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

      {archivedImages.length > 0 && (
        <ArchivedImagesStrip
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          adId={ad.id}
          scene={scene}
          archivedImages={archivedImages}
          imageUrls={imageUrls}
        />
      )}

      <div className="flex items-center gap-3">
        <CountStepper value={count} onChange={setCount} label="Count" />
        <AsyncButton
          onClick={() => onGenerate(count)}
          isPending={isGenerating}
          pendingLabel={`Generating... (${elapsedSeconds}s)`}
          className="btn-primary btn-sm"
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
  model,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  override: string | null;
  onOverrideSaved: (override: string | null) => void;
  model: ModelChoice | null;
}) {
  const [text, setText] = useState(override ?? "");
  const [isComputing, startComputing] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasComputed, setHasComputed] = useState(Boolean(override));

  function onComputePrompt() {
    setError(null);
    startComputing(async () => {
      const result = await resolveFinalImagePrompt(orgId, brandId, productId, scene, model);
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
        className="field resize-none"
      />
      <div className="flex gap-2">
        <AsyncButton
          onClick={onSave}
          isPending={isSaving}
          pendingLabel="Saving..."
          disabled={!text.trim()}
          className="btn-secondary btn-sm"
        >
          Save override
        </AsyncButton>
        {override && (
          <button
            type="button"
            onClick={onReset}
            disabled={isSaving}
            className="btn-secondary btn-sm"
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
        className={`btn-secondary btn-sm ${
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

function ArchivedImagesStrip({
  orgId,
  brandId,
  productId,
  adId,
  scene,
  archivedImages,
  imageUrls,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  adId: string;
  scene: Scene;
  archivedImages: SceneImageAsset[];
  imageUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function onRestore(assetId: string) {
    setRestoringId(assetId);
    try {
      const result = await restoreArchivedImage(orgId, brandId, productId, adId, assetId);
      if (result.ok) router.refresh();
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-foreground-muted">
        Archived images: replaced by Tweak or Rework on scene {scene.idx + 1}. Deleted after 90 days unless restored or
        saved to the Library.
      </span>
      <div className="flex flex-wrap gap-2">
        {archivedImages.map((asset) => {
          const url = imageUrls[asset.storage_path];
          return (
            <div key={asset.id} className="flex flex-col gap-1">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={`Scene ${scene.idx + 1} archived image v${asset.version}`}
                  className="h-20 w-20 rounded-lg object-cover opacity-70"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-border text-xs text-foreground-muted">
                  v{asset.version}
                </div>
              )}
              <button
                type="button"
                onClick={() => onRestore(asset.id)}
                disabled={restoringId === asset.id}
                className="btn-secondary btn-sm"
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
