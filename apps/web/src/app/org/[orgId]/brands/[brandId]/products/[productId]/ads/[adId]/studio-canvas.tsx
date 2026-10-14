"use client";

import { SceneStyleProvider, type StyleChoice } from "./scene-style-picker";
import { useState } from "react";
import { Stepper, type StudioStep, type SceneStepProgress } from "./stepper";
import { ScriptsStep } from "./scripts-step";
import { BriefStep } from "./brief-step";
import { ScenePlanStep } from "./scene-plan-step";
import { ConceptCastStep } from "./concept-cast-step";
import { StoryboardStep } from "./storyboard-step";
import { DialInStep } from "./dial-in-step";
import { SceneImagesStep } from "./scene-images-step";
import { VoiceoverStep } from "./voiceover-step";
import { SceneVideosStep } from "./scene-videos-step";
import { ExportStep } from "./export-step";
import { saveCurrentStep } from "../ads-actions";
import type { Ad } from "../ads-data";
import type { AdScriptRow } from "../scripts-data";
import type { Scene } from "../scenes-data";
import type { Concept, CastMember, BrandCastMember } from "../concepts-data";
import type { ModelOption } from "@/lib/providers/models-data";
import type { SceneImageAsset } from "../scene-images-data";
import type { SceneVideoJob, SceneVoiceover, SceneVoiceoverJob } from "../scene-videos-data";
import type { SceneSpendTotal } from "../spend-data";
import type { ActiveRevision } from "./revision-data";

export function StudioCanvas({
  orgId,
  brandId,
  productId,
  ad,
  scripts,
  scenes,
  concept,
  castMembers,
  brandCastMembers,
  assetUrls,
  imageModelOptions,
  providersWithKeys,
  costBreakdown,
  sceneImagesBySceneId,
  archivedSceneImagesBySceneId,
  sceneFeedbackImagesBySceneId,
  sceneImageUrls,
  videoModelOptions,
  sceneVideosBySceneId,
  archivedSceneVideosBySceneId,
  activeSceneVideoJobsBySceneId,
  sceneVideoUrls,
  sceneVoiceoversBySceneId,
  activeSceneVoiceoverJobsBySceneId,
  sceneSpendBySceneId,
  revision,
  styles,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scripts: AdScriptRow[];
  scenes: Scene[];
  concept: Concept | null;
  castMembers: CastMember[];
  brandCastMembers: BrandCastMember[];
  assetUrls: Record<string, string>;
  imageModelOptions: ModelOption[];
  providersWithKeys: string[];
  /** Server-rendered <CostBreakdown /> slot — composed in from page.tsx since it's an async Server Component and can't be imported directly into this Client Component. */
  costBreakdown: React.ReactNode;
  sceneImagesBySceneId: Record<string, SceneImageAsset[]>;
  archivedSceneImagesBySceneId: Record<string, SceneImageAsset[]>;
  sceneFeedbackImagesBySceneId: Record<string, SceneImageAsset[]>;
  sceneImageUrls: Record<string, string>;
  videoModelOptions: ModelOption[];
  sceneVideosBySceneId: Record<string, SceneImageAsset[]>;
  archivedSceneVideosBySceneId: Record<string, SceneImageAsset[]>;
  activeSceneVideoJobsBySceneId: Record<string, SceneVideoJob>;
  sceneVideoUrls: Record<string, string>;
  sceneVoiceoversBySceneId: Record<string, SceneVoiceover>;
  activeSceneVoiceoverJobsBySceneId: Record<string, SceneVoiceoverJob>;
  sceneSpendBySceneId: Record<string, SceneSpendTotal>;
  /** Reviewer's requested changes from the latest review round, if any. */
  revision: ActiveRevision | null;
  /** Styles a scene can switch to (built-in + this org's), for per-scene styles. */
  styles: StyleChoice[];
}) {
  const [step, setStep] = useState<StudioStep>(() => ad.current_step ?? initialStep(ad, scripts, scenes));
  const adsListHref = `/org/${orgId}/brands/${brandId}/products/${productId}/ads`;
  const previousStep = previousStepFor(step);

  // "Done" means "has at least one current asset for that scene" — jobs
  // that fail or are never started both just leave a scene absent from
  // these maps, so there's no reliable way to surface a failed-count here
  // (getActiveSceneVideoJobs/getActiveSceneVoiceoverJobs only ever return
  // queued/running rows; a failed job isn't loaded anywhere in this tree).
  const totalScenes = scenes.length;
  const sceneProgress: Partial<Record<Extract<StudioStep, "scene_images" | "voiceover" | "scene_videos">, SceneStepProgress>> = {
    scene_images: { done: Object.keys(sceneImagesBySceneId).length, total: totalScenes },
    voiceover: { done: Object.keys(sceneVoiceoversBySceneId).length, total: totalScenes },
    scene_videos: { done: Object.keys(sceneVideosBySceneId).length, total: totalScenes },
  };

  // Wraps setStep so every navigation (stepper click, "Previous step",
  // or a step's own "Continue") also persists ad.current_step — see
  // saveCurrentStep's doc comment for why. Fire-and-forget: a failed
  // write just means the old heuristic kicks in again next reload,
  // which is a harmless fallback, not worth blocking navigation on.
  function goToStep(next: StudioStep) {
    setStep(next);
    void saveCurrentStep(orgId, ad.id, next);
  }

  return (
    <SceneStyleProvider value={{ orgId, brandId, productId, adId: ad.id, adStyleId: ad.style_id, styles }}>
    <div className="flex min-h-screen flex-col">
      <Stepper
        currentStep={step}
        onStepClick={goToStep}
        onPreviousStep={previousStep ? () => goToStep(previousStep) : undefined}
        adsListHref={adsListHref}
        sceneProgress={sceneProgress}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        {costBreakdown}
        {revision && (
          <div className="card flex flex-col gap-2 border-danger/40 p-4">
            <p className="text-sm font-semibold text-danger">Changes requested (review round {revision.roundNo})</p>
            {revision.overallNote && <p className="text-sm">{revision.overallNote}</p>}
            <p className="text-xs text-foreground-muted">
              {Object.keys(revision.notes).length > 0
                ? `${Object.keys(revision.notes).length} scene${Object.keys(revision.notes).length === 1 ? "" : "s"} flagged. Each one is highlighted with the reviewer's note, already filled into its feedback box.`
                : "No individual scenes were flagged."}{" "}
              When you&apos;re done, move the task back to In review.
            </p>
            {Object.keys(revision.notes).length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => goToStep("scene_images")} className="btn-secondary btn-sm">
                  Scene images
                </button>
                <button type="button" onClick={() => goToStep("scene_videos")} className="btn-secondary btn-sm">
                  Scene videos
                </button>
              </div>
            )}
          </div>
        )}
        {step === "scripts" && (
          <ScriptsStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scripts={scripts}
            onContinue={() => goToStep("dial_in")}
            onUseBriefInstead={() => goToStep("brief")}
          />
        )}
        {step === "brief" && (
          <BriefStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            onContinue={() => goToStep("dial_in")}
          />
        )}
        {step === "dial_in" && (
          <DialInStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            onContinue={() => goToStep("plan")}
          />
        )}
        {step === "plan" && (
          <ScenePlanStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            onContinue={() => goToStep("concept")}
          />
        )}
        {step === "concept" && (
          <ConceptCastStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            concept={concept}
            castMembers={castMembers}
            brandCastMembers={brandCastMembers}
            assetUrls={assetUrls}
            imageModelOptions={imageModelOptions}
            providersWithKeys={new Set(providersWithKeys)}
            onContinue={() => goToStep("storyboard")}
          />
        )}
        {step === "storyboard" && (
          <StoryboardStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            onContinue={() => goToStep("scene_images")}
          />
        )}
        {step === "scene_images" && (
          <SceneImagesStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            imagesBySceneId={sceneImagesBySceneId}
            archivedImagesBySceneId={archivedSceneImagesBySceneId}
            feedbackImagesBySceneId={sceneFeedbackImagesBySceneId}
            imageUrls={sceneImageUrls}
            imageModelOptions={imageModelOptions}
            providersWithKeys={new Set(providersWithKeys)}
            sceneSpendBySceneId={sceneSpendBySceneId}
            revisionNotes={revision?.notes ?? {}}
            onContinue={() => goToStep("voiceover")}
          />
        )}
        {step === "voiceover" && (
          <VoiceoverStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            voiceoversBySceneId={sceneVoiceoversBySceneId}
            activeJobsBySceneId={activeSceneVoiceoverJobsBySceneId}
            assetUrls={sceneVideoUrls}
            onContinue={() => goToStep("scene_videos")}
          />
        )}
        {step === "scene_videos" && (
          <SceneVideosStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            imagesBySceneId={sceneImagesBySceneId}
            videosBySceneId={sceneVideosBySceneId}
            archivedVideosBySceneId={archivedSceneVideosBySceneId}
            activeJobsBySceneId={activeSceneVideoJobsBySceneId}
            assetUrls={sceneVideoUrls}
            videoModelOptions={videoModelOptions}
            providersWithKeys={new Set(providersWithKeys)}
            sceneSpendBySceneId={sceneSpendBySceneId}
            revisionNotes={revision?.notes ?? {}}
            onContinue={() => goToStep("export")}
          />
        )}
        {step === "export" && <ExportStep orgId={orgId} ad={ad} scenes={scenes} />}
      </div>
    </div>
    </SceneStyleProvider>
  );
}

/**
 * Step-back order for the in-Studio "Previous step" control. "brief"
 * steps back to "scripts" (its own fallback origin) rather than
 * "dial_in", since that's where the editor actually came from.
 * Returns undefined on the first reachable step (nothing to go back
 * to within the Studio — use the "Back to ads" link instead).
 */
function previousStepFor(step: StudioStep): StudioStep | undefined {
  switch (step) {
    case "scripts":
      return undefined;
    case "brief":
      return "scripts";
    case "dial_in":
      return "scripts";
    case "plan":
      return "dial_in";
    case "concept":
      return "plan";
    case "storyboard":
      return "concept";
    case "scene_images":
      return "storyboard";
    case "voiceover":
      return "scene_images";
    case "scene_videos":
      return "voiceover";
    case "export":
      return "scene_videos";
  }
}

function initialStep(ad: Ad, scripts: AdScriptRow[], scenes: Scene[]): StudioStep {
  if (ad.plan_locked) return "concept";
  if (scenes.length > 0) return "plan";
  const hasSelectedScript = scripts.some((s) => s.selected);
  const hasManualBrief = Boolean(ad.brief.hooks?.length || ad.brief.body || ad.brief.idea);
  if (hasSelectedScript || hasManualBrief) return "plan";
  return "scripts";
}
