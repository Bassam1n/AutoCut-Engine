"use client";

import { useState } from "react";
import { Stepper, type StudioStep } from "./stepper";
import { ScriptsStep } from "./scripts-step";
import { BriefStep } from "./brief-step";
import { ScenePlanStep } from "./scene-plan-step";
import { ConceptCastStep } from "./concept-cast-step";
import { StoryboardStep } from "./storyboard-step";
import { DialInStep } from "./dial-in-step";
import { SceneImagesStep } from "./scene-images-step";
import { SceneVideosStep } from "./scene-videos-step";
import { saveCurrentStep } from "../ads-actions";
import type { Ad } from "../ads-data";
import type { AdScriptRow } from "../scripts-data";
import type { Scene } from "../scenes-data";
import type { Concept, CastMember } from "../concepts-data";
import type { ModelOption } from "@/lib/providers/models-data";
import type { SceneImageAsset } from "../scene-images-data";
import type { SceneVideoJob } from "../scene-videos-data";

export function StudioCanvas({
  orgId,
  brandId,
  productId,
  ad,
  scripts,
  scenes,
  concept,
  castMembers,
  assetUrls,
  imageModelOptions,
  providersWithKeys,
  costBreakdown,
  sceneImagesBySceneId,
  sceneFeedbackImagesBySceneId,
  sceneImageUrls,
  videoModelOptions,
  sceneVideosBySceneId,
  archivedSceneVideosBySceneId,
  activeSceneVideoJobsBySceneId,
  sceneVideoUrls,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scripts: AdScriptRow[];
  scenes: Scene[];
  concept: Concept | null;
  castMembers: CastMember[];
  assetUrls: Record<string, string>;
  imageModelOptions: ModelOption[];
  providersWithKeys: string[];
  /** Server-rendered <CostBreakdown /> slot — composed in from page.tsx since it's an async Server Component and can't be imported directly into this Client Component. */
  costBreakdown: React.ReactNode;
  sceneImagesBySceneId: Record<string, SceneImageAsset[]>;
  sceneFeedbackImagesBySceneId: Record<string, SceneImageAsset[]>;
  sceneImageUrls: Record<string, string>;
  videoModelOptions: ModelOption[];
  sceneVideosBySceneId: Record<string, SceneImageAsset[]>;
  archivedSceneVideosBySceneId: Record<string, SceneImageAsset[]>;
  activeSceneVideoJobsBySceneId: Record<string, SceneVideoJob>;
  sceneVideoUrls: Record<string, string>;
}) {
  const [step, setStep] = useState<StudioStep>(() => ad.current_step ?? initialStep(ad, scripts, scenes));
  const adsListHref = `/org/${orgId}/brands/${brandId}/products/${productId}/ads`;
  const previousStep = previousStepFor(step);

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
    <div className="flex min-h-screen flex-col">
      <Stepper
        currentStep={step}
        onStepClick={goToStep}
        onPreviousStep={previousStep ? () => goToStep(previousStep) : undefined}
        adsListHref={adsListHref}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        {costBreakdown}
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
            feedbackImagesBySceneId={sceneFeedbackImagesBySceneId}
            imageUrls={sceneImageUrls}
            imageModelOptions={imageModelOptions}
            providersWithKeys={new Set(providersWithKeys)}
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
          />
        )}
      </div>
    </div>
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
    case "scene_videos":
      return "scene_images";
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
