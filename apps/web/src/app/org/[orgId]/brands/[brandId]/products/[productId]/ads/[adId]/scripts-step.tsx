"use client";

import { useState, useTransition } from "react";
import { generateScripts, selectScript } from "../scripts-actions";
import { LoadingIndicator } from "@/components/loading-indicator";
import type { Ad } from "../ads-data";
import type { AdScriptRow } from "../scripts-data";
import { buttonVariants } from "@/components/button";

export function ScriptsStep({
  orgId,
  brandId,
  productId,
  ad,
  scripts,
  onContinue,
  onUseBriefInstead,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scripts: AdScriptRow[];
  onContinue: () => void;
  onUseBriefInstead: () => void;
}) {
  const [lengthInput, setLengthInput] = useState(
    ad.target_length_seconds ? String(ad.target_length_seconds) : "30"
  );
  const [isGenerating, startGenerating] = useTransition();
  const [isSelecting, startSelecting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    const length = Number(lengthInput);
    if (!Number.isFinite(length) || length <= 0) {
      setError("Enter a valid ad length in seconds.");
      return;
    }

    startGenerating(async () => {
      const result = await generateScripts(orgId, brandId, productId, ad.id, length);
      if (!result.ok) setError(result.error);
    });
  }

  function onSelect(scriptId: string) {
    setError(null);
    startSelecting(async () => {
      const result = await selectScript(orgId, brandId, productId, ad.id, scriptId);
      if (result.ok) {
        onContinue();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Scripts</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Set the ad length and generate three script variations using the
          brand, customer and product details you&apos;ve already set up. Pick
          the one that fits best.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="length" className="text-sm font-medium">
            Ad length (seconds)
          </label>
          <input
            id="length"
            type="number"
            min={1}
            value={lengthInput}
            onChange={(e) => setLengthInput(e.target.value)}
            disabled={isGenerating}
            className="w-28 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className={buttonVariants.primary}
        >
          {isGenerating ? (
            <LoadingIndicator label="Generating scripts..." />
          ) : scripts.length > 0 ? (
            "Regenerate scripts"
          ) : (
            "Generate 3 scripts"
          )}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {scripts.length > 0 && (
        <div className="flex flex-col gap-3">
          {scripts.map((script) => (
            <div
              key={script.id}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${
                script.selected ? "border-accent bg-accent-soft/40" : "border-border"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Variant {script.variant_index}
              </p>
              <p className="text-sm font-medium">{script.hook}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground-muted">{script.body}</p>
              <p className="text-sm font-medium text-accent">{script.cta}</p>
              <button
                type="button"
                onClick={() => onSelect(script.id)}
                disabled={isSelecting}
                className="mt-1 self-start rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
              >
                {script.selected ? "Selected ✓" : "Use this script"}
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onUseBriefInstead}
        className="self-start text-xs font-medium text-foreground-muted hover:underline"
      >
        None of these fit — write a brief by hand instead
      </button>
    </div>
  );
}
