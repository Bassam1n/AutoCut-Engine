"use client";

import { useState, useTransition } from "react";
import {
  generateScenePlan,
  updateSceneCopy,
  setSceneNote,
  splitScene,
  mergeSceneIntoPrevious,
  duplicateScene,
} from "../scenes-actions";
import { lockPlan } from "../ads-actions";
import { PromptModal } from "@/components/modal";
import { LoadingIndicator } from "@/components/loading-indicator";
import type { Ad } from "../ads-data";
import type { Scene, SceneNote } from "../scenes-data";
import { buttonVariants } from "@/components/button";

const HOOK_GROUP_LABELS: Record<string, string> = {
  hook_1: "Hook 1",
  hook_2: "Hook 2",
  hook_3: "Hook 3",
  body: "Body",
  cta: "CTA",
};

export function ScenePlanStep({
  orgId,
  brandId,
  productId,
  ad,
  scenes,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scenes: Scene[];
  onContinue: () => void;
}) {
  const [isGenerating, startGenerating] = useTransition();
  const [isLocking, startLocking] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    startGenerating(async () => {
      const result = await generateScenePlan(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onLock() {
    setError(null);
    startLocking(async () => {
      const result = await lockPlan(orgId, brandId, productId, ad.id);
      if (result.ok) {
        onContinue();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Scene plan</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            The copy is split into scenes using the style&apos;s cutting
            rules. Edit, split, merge, or pin a note per scene, then lock
            the plan — later steps never re-split it.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating || ad.plan_locked}
          className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          {isGenerating ? <LoadingIndicator label="Generating scene plan..." /> : scenes.length > 0 ? "Regenerate" : "Generate scene plan"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {scenes.length > 0 ? (
        <div className="flex flex-col gap-3">
          {scenes.map((scene, i) => (
            <SceneRow
              key={scene.id}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              scene={scene}
              isFirst={i === 0}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">
          No scenes yet — generate a plan from the selected script.
        </p>
      )}

      {ad.plan_locked ? (
        <p className="text-sm font-medium text-accent">Plan locked ✓</p>
      ) : (
        <button
          type="button"
          onClick={onLock}
          disabled={isLocking || scenes.length === 0}
          className={`self-start ${buttonVariants.primary}`}
        >
          {isLocking ? "Locking..." : "Lock the plan"}
        </button>
      )}

      {ad.plan_locked && (
        <button
          type="button"
          onClick={onContinue}
          className="self-start text-xs font-medium text-accent hover:underline"
        >
          Continue →
        </button>
      )}
    </div>
  );
}

function SceneRow({
  orgId,
  brandId,
  productId,
  ad,
  scene,
  isFirst,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  isFirst: boolean;
}) {
  const [copy, setCopy] = useState(scene.copy);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteModalType, setNoteModalType] = useState<SceneNote["type"] | null>(null);
  const note = isNote(scene.notes) ? scene.notes : null;

  function saveCopy() {
    if (copy === scene.copy) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSceneCopy(orgId, brandId, productId, ad.id, scene.id, copy);
      if (!result.ok) setError(result.error);
    });
  }

  function onRemoveNote() {
    setError(null);
    startTransition(async () => {
      const result = await setSceneNote(orgId, brandId, productId, ad.id, scene.id, null);
      if (!result.ok) setError(result.error);
    });
  }

  function onSubmitNote(text: string) {
    const type = noteModalType;
    setNoteModalType(null);
    if (!type || !text.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await setSceneNote(orgId, brandId, productId, ad.id, scene.id, { type, text });
      if (!result.ok) setError(result.error);
    });
  }

  function onSplit() {
    setError(null);
    startTransition(async () => {
      const result = await splitScene(orgId, brandId, productId, ad.id, scene.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onMerge() {
    setError(null);
    startTransition(async () => {
      const result = await mergeSceneIntoPrevious(orgId, brandId, productId, ad.id, scene.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onDuplicate() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateScene(orgId, brandId, productId, ad.id, scene.id);
      if (!result.ok) setError(result.error);
    });
  }

  const hookLabel = scene.hook_group ? HOOK_GROUP_LABELS[scene.hook_group] : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
          {hookLabel && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {hookLabel}
            </span>
          )}
          {scene.duration_s != null && (
            <span className="text-xs text-foreground-muted">~{scene.duration_s}s</span>
          )}
        </div>
        {note && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              note.type === "rule" ? "bg-danger/10 text-danger" : "bg-border/50 text-foreground-muted"
            }`}
          >
            {note.type === "rule" ? "Rule" : "Idea"}
          </span>
        )}
      </div>

      <textarea
        value={copy}
        onChange={(e) => setCopy(e.target.value)}
        onBlur={saveCopy}
        disabled={ad.plan_locked || isPending}
        rows={2}
        className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
      />

      {error && <p className="text-xs text-danger">{error}</p>}

      {!ad.plan_locked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => (note?.type === "idea" ? onRemoveNote() : setNoteModalType("idea"))}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
          >
            {note?.type === "idea" ? "Remove idea note" : "Pin idea note"}
          </button>
          <button
            type="button"
            onClick={() => (note?.type === "rule" ? onRemoveNote() : setNoteModalType("rule"))}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
          >
            {note?.type === "rule" ? "Remove rule note" : "Pin rule note"}
          </button>
          <button
            type="button"
            onClick={onSplit}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
          >
            Split
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
          >
            Duplicate
          </button>
          {!isFirst && (
            <button
              type="button"
              onClick={onMerge}
              disabled={isPending}
              className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
            >
              Merge into previous
            </button>
          )}
        </div>
      )}

      {noteModalType && (
        <PromptModal
          title={noteModalType === "rule" ? "Pin a rule note" : "Pin an idea note"}
          label={
            noteModalType === "rule"
              ? "Rule text — kept word-for-word, survives regeneration"
              : "Idea note — the writer may adapt it"
          }
          placeholder={note?.text ?? ""}
          onSubmit={onSubmitNote}
          onClose={() => setNoteModalType(null)}
        />
      )}
    </div>
  );
}

function isNote(value: unknown): value is SceneNote {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "text" in value &&
    (value as SceneNote).type !== undefined
  );
}
