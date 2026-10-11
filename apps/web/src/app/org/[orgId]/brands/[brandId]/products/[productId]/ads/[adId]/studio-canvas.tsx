"use client";

import { useState } from "react";
import { Stepper, type StudioStep } from "./stepper";
import { ScriptsStep } from "./scripts-step";
import { BriefStep } from "./brief-step";
import { ScenePlanStep } from "./scene-plan-step";
import { ConceptCastStep } from "./concept-cast-step";
import type { Ad } from "../ads-data";
import type { AdScriptRow } from "../scripts-data";
import type { Scene } from "../scenes-data";
import type { Concept, CastMember } from "../concepts-data";
import type { ModelOption } from "@/lib/providers/models-data";

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
}) {
  const [step, setStep] = useState<StudioStep>(() => initialStep(ad, scripts, scenes));
  const adsListHref = `/org/${orgId}/brands/${brandId}/products/${productId}/ads`;
  const previousStep = previousStepFor(step);

  return (
    <div className="flex min-h-screen flex-col">
      <Stepper
        currentStep={step}
        onStepClick={setStep}
        onPreviousStep={previousStep ? () => setStep(previousStep) : undefined}
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
            onContinue={() => setStep("dial_in")}
            onUseBriefInstead={() => setStep("brief")}
          />
        )}
        {step === "brief" && (
          <BriefStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            onContinue={() => setStep("dial_in")}
          />
        )}
        {step === "dial_in" && <ComingSoonStep label="Dial it in" onContinue={() => setStep("plan")} />}
        {step === "plan" && (
          <ScenePlanStep
            orgId={orgId}
            brandId={brandId}
            productId={productId}
            ad={ad}
            scenes={scenes}
            onContinue={() => setStep("concept")}
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
            onContinue={() => setStep("storyboard")}
          />
        )}
        {step === "storyboard" && <ComingSoonStep label="Storyboard" onContinue={() => setStep("review")} />}
        {step === "review" && <ComingSoonStep label="Review" />}
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
    case "review":
      return "storyboard";
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

function ComingSoonStep({ label, onContinue }: { label: string; onContinue?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium text-foreground-muted">{label}</p>
      <p className="max-w-sm text-xs text-foreground-muted">
        This step isn&apos;t built yet — the Studio flow shell is in place so
        the whole path through an ad is navigable, with each step filled in
        next.
      </p>
      {onContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="mt-2 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40"
        >
          Skip for now →
        </button>
      )}
    </div>
  );
}
