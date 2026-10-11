"use client";

import Link from "next/link";

export type StudioStep =
  | "scripts"
  | "brief"
  | "dial_in"
  | "plan"
  | "concept"
  | "storyboard"
  | "review";

// "brief" is deliberately not in this list — it's the manual fallback
// used only when the editor rejects all 3 generated scripts, not a
// numbered step in the main stepper (spec decision: scripts-first,
// per the user's correction to the original brief-first M5 shell).
const STEPS: { id: Exclude<StudioStep, "brief">; label: string }[] = [
  { id: "scripts", label: "Scripts" },
  { id: "dial_in", label: "Dial it in" },
  { id: "plan", label: "Scene plan" },
  { id: "concept", label: "Concept & cast" },
  { id: "storyboard", label: "Storyboard" },
  { id: "review", label: "Review" },
];

export function Stepper({
  currentStep,
  onStepClick,
  onPreviousStep,
  adsListHref,
}: {
  currentStep: StudioStep;
  onStepClick?: (step: StudioStep) => void;
  /** Steps back one Studio phase without leaving the ad — undefined on the first step. */
  onPreviousStep?: () => void;
  /** Where the top-level "leave Studio" back link goes — the ad's product's ads list. */
  adsListHref: string;
}) {
  // "brief" has no entry of its own in STEPS (it's the fallback off of
  // "scripts") — treat it as still being on the "scripts" step so the
  // stepper highlights the right chip instead of highlighting nothing.
  const effectiveStep = currentStep === "brief" ? "scripts" : currentStep;
  const currentIndex = STEPS.findIndex((s) => s.id === effectiveStep);

  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex items-center gap-3 px-6 pt-3">
        <Link
          href={adsListHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span> Back to ads
        </Link>
        {onPreviousStep && (
          <button
            type="button"
            onClick={onPreviousStep}
            className="inline-flex items-center gap-1 rounded-lg border border-border-strong px-2 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-border/40 hover:text-foreground"
          >
            <span aria-hidden="true">←</span> Previous step
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 overflow-x-auto px-6 py-3">
      {STEPS.map((step, i) => {
        const isActive = step.id === effectiveStep;
        const isDone = i < currentIndex;
        const isClickable = isDone && onStepClick;

        return (
          <div key={step.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(step.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent-soft text-accent"
                  : isDone
                    ? "text-foreground-muted hover:bg-border/40"
                    : "text-foreground-muted/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isActive
                    ? "bg-accent text-accent-ink"
                    : isDone
                      ? "bg-foreground-muted text-background"
                      : "border border-border-strong"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </span>
              {step.label}
            </button>
            {i < STEPS.length - 1 && (
              <span className="shrink-0 text-foreground-muted/40">→</span>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
