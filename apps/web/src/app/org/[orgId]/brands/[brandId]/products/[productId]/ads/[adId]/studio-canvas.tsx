"use client";

import { useState } from "react";
import { Stepper, type StudioStep } from "./stepper";
import { ScriptsStep } from "./scripts-step";
import { BriefStep } from "./brief-step";
import type { Ad } from "../ads-data";
import type { AdScriptRow } from "../scripts-data";

export function StudioCanvas({
  orgId,
  brandId,
  productId,
  ad,
  scripts,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scripts: AdScriptRow[];
}) {
  const [step, setStep] = useState<StudioStep>(() => initialStep(ad, scripts));

  return (
    <div className="flex min-h-screen flex-col">
      <Stepper currentStep={step} onStepClick={setStep} />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
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
        {step === "plan" && <ComingSoonStep label="Scene plan" onContinue={() => setStep("concept")} />}
        {step === "concept" && <ComingSoonStep label="Concept & cast" onContinue={() => setStep("storyboard")} />}
        {step === "storyboard" && <ComingSoonStep label="Storyboard" onContinue={() => setStep("review")} />}
        {step === "review" && <ComingSoonStep label="Review" />}
      </div>
    </div>
  );
}

function initialStep(ad: Ad, scripts: AdScriptRow[]): StudioStep {
  if (ad.plan_locked) return "concept";
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
