"use client";

export type StudioStep = "brief" | "dial_in" | "plan" | "concept" | "storyboard" | "review";

const STEPS: { id: StudioStep; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "dial_in", label: "Dial it in" },
  { id: "plan", label: "Scene plan" },
  { id: "concept", label: "Concept & cast" },
  { id: "storyboard", label: "Storyboard" },
  { id: "review", label: "Review" },
];

export function Stepper({
  currentStep,
  onStepClick,
}: {
  currentStep: StudioStep;
  onStepClick?: (step: StudioStep) => void;
}) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-6 py-3">
      {STEPS.map((step, i) => {
        const isActive = step.id === currentStep;
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
  );
}
