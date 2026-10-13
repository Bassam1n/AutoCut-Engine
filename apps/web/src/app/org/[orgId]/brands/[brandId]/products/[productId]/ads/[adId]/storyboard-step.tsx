"use client";

import { useState, useTransition } from "react";
import {
  toggleProductInFrame,
  updateSceneVisual,
  patchStoryboard,
} from "../storyboard-actions";
import { splitScene, mergeSceneIntoPrevious, updateSceneCopy } from "../scenes-actions";
import { rewriteSceneVisual } from "../scene-visuals-actions";
import { AsyncButton } from "@/components/async-button";
import type { Ad } from "../ads-data";
import type { Scene } from "../scenes-data";

const HOOK_GROUP_LABELS: Record<string, string> = {
  hook_1: "Hook 1",
  hook_2: "Hook 2",
  hook_3: "Hook 3",
  body: "Body",
  cta: "CTA",
};

export function StoryboardStep({
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
  const [activeSceneId, setActiveSceneId] = useState<string | null>(scenes[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Storyboard</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Review and edit each scene&apos;s copy and visual. Split, merge, or
            patch the whole board by chat.
          </p>
        </div>
      </div>

      {scenes.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No scenes yet — generate the storyboard from Concept &amp; cast first.
        </p>
      ) : (
        <>
          <SceneRail scenes={scenes} activeSceneId={activeSceneId} onJump={setActiveSceneId} />

          <ChatPatch orgId={orgId} brandId={brandId} productId={productId} ad={ad} />

          <div className="flex flex-col gap-3">
            {scenes.map((scene, i) => (
              <StoryboardRow
                key={scene.id}
                orgId={orgId}
                brandId={brandId}
                productId={productId}
                ad={ad}
                scene={scene}
                isFirst={i === 0}
                isActive={scene.id === activeSceneId}
                onFocus={() => setActiveSceneId(scene.id)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={onContinue}
            className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Continue to scene images →
          </button>
        </>
      )}
    </div>
  );
}

function SceneRail({
  scenes,
  activeSceneId,
  onJump,
}: {
  scenes: Scene[];
  activeSceneId: string | null;
  onJump: (sceneId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-background-raised/50 p-3">
      {scenes.map((scene) => {
        const isActive = scene.id === activeSceneId;
        const stageColor = scene.visual
          ? "bg-accent"
          : scene.copy
            ? "bg-border-strong"
            : "bg-border";
        return (
          <button
            key={scene.id}
            type="button"
            onClick={() => onJump(scene.id)}
            title={`Scene ${scene.idx + 1}`}
            className={`h-2.5 w-2.5 shrink-0 rounded-full transition-transform ${stageColor} ${
              isActive ? "scale-150" : "hover:scale-125"
            }`}
          />
        );
      })}
    </div>
  );
}

function ChatPatch({
  orgId,
  brandId,
  productId,
  ad,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
}) {
  const [instruction, setInstruction] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  function onSubmit() {
    setError(null);
    setLastSummary(null);
    startTransition(async () => {
      const result = await patchStoryboard(orgId, brandId, productId, ad.id, instruction);
      if (result.ok) {
        setLastSummary(result.summary);
        setInstruction("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <label className="text-xs font-medium">Edit by chat</label>
      <div className="flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. make scene 3's CTA mention the discount"
          disabled={isPending}
          className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
        <AsyncButton
          onClick={onSubmit}
          isPending={isPending}
          pendingLabel="Patching..."
          disabled={!instruction.trim()}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Patch
        </AsyncButton>
      </div>
      {lastSummary && <p className="text-xs text-accent">{lastSummary}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function StoryboardRow({
  orgId,
  brandId,
  productId,
  ad,
  scene,
  isFirst,
  isActive,
  onFocus,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scene: Scene;
  isFirst: boolean;
  isActive: boolean;
  onFocus: () => void;
}) {
  const [copy, setCopy] = useState(scene.copy);
  const [visual, setVisual] = useState(scene.visual);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [isRewriting, startRewriteTransition] = useTransition();

  const productInFrame = scene.product_id !== null;
  const hookLabel = scene.hook_group ? HOOK_GROUP_LABELS[scene.hook_group] : null;

  function saveCopy() {
    if (copy === scene.copy) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSceneCopy(orgId, brandId, productId, ad.id, scene.id, copy);
      if (!result.ok) setError(result.error);
    });
  }

  function saveVisual() {
    if (visual === scene.visual) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSceneVisual(orgId, brandId, productId, ad.id, scene.id, visual);
      if (!result.ok) setError(result.error);
    });
  }

  function onToggleProduct() {
    setError(null);
    startTransition(async () => {
      const result = await toggleProductInFrame(orgId, brandId, productId, ad.id, scene.id, !productInFrame);
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

  function onRewriteVisual() {
    setError(null);
    startRewriteTransition(async () => {
      const result = await rewriteSceneVisual(
        orgId,
        brandId,
        productId,
        ad.id,
        scene.id,
        rewriteInstruction
      );
      if (result.ok) {
        setVisual(result.visual);
        setRewriteInstruction("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div
      onFocus={onFocus}
      onClick={onFocus}
      className={`flex flex-col gap-2 rounded-xl border p-4 transition-colors ${
        isActive ? "border-accent" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
          {hookLabel && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {hookLabel}
            </span>
          )}
          {scene.route && (
            <span className="rounded-full bg-border/50 px-2 py-0.5 text-xs text-foreground-muted">
              {scene.route}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleProduct}
          disabled={isPending}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
            productInFrame
              ? "bg-accent-soft text-accent"
              : "border border-border-strong text-foreground-muted hover:bg-border/40"
          }`}
        >
          {productInFrame ? "Product in frame ✓" : "Product not in frame"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-foreground-muted">Copy</label>
        <textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          onBlur={saveCopy}
          rows={2}
          disabled={isPending}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-foreground-muted">Visual</label>
        <textarea
          value={visual}
          onChange={(e) => setVisual(e.target.value)}
          onBlur={saveVisual}
          rows={2}
          placeholder="No visual generated yet"
          disabled={isPending || isRewriting}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
        <div className="flex gap-2">
          <input
            value={rewriteInstruction}
            onChange={(e) => setRewriteInstruction(e.target.value)}
            placeholder="e.g. make it more dynamic (optional — leave blank to just improve it)"
            disabled={isRewriting}
            className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-1.5 text-xs outline-none disabled:opacity-60"
          />
          <AsyncButton
            onClick={onRewriteVisual}
            isPending={isRewriting}
            pendingLabel="Rewriting..."
            disabled={isPending}
            className="shrink-0 rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40"
          >
            ✨ Rewrite
          </AsyncButton>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSplit}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          Split
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
    </div>
  );
}
