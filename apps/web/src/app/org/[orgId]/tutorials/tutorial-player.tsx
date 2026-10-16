"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Tutorial } from "@/lib/tutorials";

const DONE_KEY = "autocut-tutorials-done";

export function readDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markDone(id: string) {
  try {
    const done = readDone();
    done.add(id);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // Private mode or blocked storage: completion just isn't remembered.
  }
}

/**
 * Click-through tutorial: a screenshot of the real app with a pulsing
 * hotspot on what to click, and a tooltip explaining it. Clicking the
 * hotspot (or Next, or the right arrow key) moves on.
 */
export function TutorialPlayer({
  orgId,
  tutorial,
  nextTutorial,
  onClose,
  onOpenTutorial,
}: {
  orgId: string;
  tutorial: Tutorial;
  nextTutorial: Tutorial | null;
  onClose: () => void;
  onOpenTutorial: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const total = tutorial.steps.length;
  const step = tutorial.steps[index];

  const next = useCallback(() => {
    if (index < total - 1) setIndex(index + 1);
    else {
      markDone(tutorial.id);
      setFinished(true);
    }
  }, [index, total, tutorial.id]);
  const prev = useCallback(() => {
    if (finished) setFinished(false);
    else if (index > 0) setIndex(index - 1);
  }, [finished, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // Preload the next screenshot so steps change instantly.
  useEffect(() => {
    const upcoming = tutorial.steps[index + 1];
    if (upcoming) new Image().src = upcoming.image;
  }, [index, tutorial.steps]);

  const box = step.box;
  // Tooltip beside the hotspot: to its right when there's room, else to its left.
  const placeRight = box ? box.x + box.w < 0.6 : true;
  const tooltipStyle: React.CSSProperties = box
    ? {
        top: `${Math.min(Math.max(box.y * 100, 2), 62)}%`,
        ...(placeRight ? { left: `${(box.x + box.w) * 100 + 1.5}%` } : { right: `${(1 - box.x) * 100 + 1.5}%` }),
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const appHref = tutorial.appPath?.replace("{org}", orgId) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tutorial.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div className="flex w-full max-w-6xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{tutorial.title}</p>
            <p className="text-xs text-white/70">
              {finished ? "Complete" : `Step ${index + 1} of ${total}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tutorial"
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
          >
            Close
          </button>
        </div>

        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-background shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.image} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />

          {!finished && box && (
            <>
              <button
                type="button"
                onClick={next}
                aria-label={step.click ? `Click: ${step.title}` : "Next step"}
                className="absolute rounded-xl ring-2 ring-accent transition-all duration-300"
                style={{
                  left: `${box.x * 100 - 0.4}%`,
                  top: `${box.y * 100 - 0.6}%`,
                  width: `${box.w * 100 + 0.8}%`,
                  height: `${box.h * 100 + 1.2}%`,
                  boxShadow: "0 0 0 9999px rgba(10, 10, 12, 0.38)",
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{
                  // Small targets (a menu item, a button): dot at the end so
                  // it doesn't cover the label. Large ones: in the middle.
                  left: `${(box.w < 0.2 ? box.x + box.w : box.x + box.w / 2) * 100}%`,
                  top: `${(box.y + box.h / 2) * 100}%`,
                }}
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-accent ring-2 ring-white" />
              </span>
            </>
          )}

          {!finished && (
            <div
              className="absolute hidden w-[min(320px,38%)] flex-col gap-3 rounded-2xl bg-accent p-4 text-white shadow-xl sm:flex"
              style={tooltipStyle}
            >
              <TooltipBody step={step} index={index} total={total} onPrev={prev} onNext={next} />
            </div>
          )}

          {finished && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4">
              <div className="card flex w-full max-w-sm flex-col gap-3 p-5 text-center">
                <p className="text-lg font-semibold">Nice, that&apos;s {tutorial.title.toLowerCase()}.</p>
                <p className="text-sm text-foreground-muted">You&apos;ve seen every step. Try it for real, or keep going.</p>
                <div className="flex flex-col gap-2">
                  {appHref && (
                    <Link href={appHref} onClick={onClose} className="btn-primary">
                      Open it in the app
                    </Link>
                  )}
                  {nextTutorial && (
                    <button type="button" onClick={() => onOpenTutorial(nextTutorial.id)} className="btn-secondary">
                      Next: {nextTutorial.title}
                    </button>
                  )}
                  <button type="button" onClick={() => { setFinished(false); setIndex(0); }} className="btn-ghost btn-sm">
                    Watch again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Small screens: the tooltip sits under the screenshot. */}
        {!finished && (
          <div className="flex flex-col gap-3 rounded-2xl bg-accent p-4 text-white sm:hidden">
            <TooltipBody step={step} index={index} total={total} onPrev={prev} onNext={next} />
          </div>
        )}

        <div className="h-1 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${((finished ? total : index + 1) / total) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function TooltipBody({
  step,
  index,
  total,
  onPrev,
  onNext,
}: {
  step: Tutorial["steps"][number];
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <div>
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/90">{step.body}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-white/70">
          {step.click ? "Click the highlight to continue" : `${index + 1} / ${total}`}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={index === 0}
            aria-label="Previous step"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={index === total - 1 ? "Finish" : "Next step"}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
