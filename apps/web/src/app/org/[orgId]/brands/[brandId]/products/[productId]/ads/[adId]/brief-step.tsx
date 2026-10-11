"use client";

import { useState, useTransition } from "react";
import { saveBrief } from "../ads-actions";
import { LoadingIndicator } from "@/components/loading-indicator";
import type { Ad, AdBrief } from "../ads-data";

const MAX_HOOKS = 3;

export function BriefStep({
  orgId,
  brandId,
  productId,
  ad,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  onContinue: () => void;
}) {
  const [hooks, setHooks] = useState<string[]>(ad.brief.hooks ?? [""]);
  const [body, setBody] = useState(ad.brief.body ?? "");
  const [cta, setCta] = useState(ad.brief.cta ?? "");
  const [idea, setIdea] = useState(ad.brief.idea ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addHook() {
    if (hooks.length < MAX_HOOKS) setHooks([...hooks, ""]);
  }

  function removeHook(index: number) {
    setHooks(hooks.filter((_, i) => i !== index));
  }

  function updateHook(index: number, value: string) {
    setHooks(hooks.map((h, i) => (i === index ? value : h)));
  }

  function onSave() {
    setError(null);
    const brief: AdBrief = {
      hooks: hooks.map((h) => h.trim()).filter(Boolean),
      body: body.trim() || undefined,
      cta: cta.trim() || undefined,
      idea: idea.trim() || undefined,
    };

    startTransition(async () => {
      const result = await saveBrief(orgId, brandId, productId, ad.id, brief);
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
        <h2 className="text-lg font-semibold tracking-tight">Brief</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Up to three hooks, the body of the ad, a call to action, and any
          free-form idea notes.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Hooks</label>
        {hooks.map((hook, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={hook}
              onChange={(e) => updateHook(i, e.target.value)}
              placeholder={`Hook ${i + 1}`}
              disabled={isPending}
              className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
            />
            {hooks.length > 1 && (
              <button
                type="button"
                onClick={() => removeHook(i)}
                disabled={isPending}
                className="rounded-lg border border-border-strong px-2.5 text-sm text-foreground-muted transition-colors hover:bg-border/40 disabled:opacity-60"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {hooks.length < MAX_HOOKS && (
          <button
            type="button"
            onClick={addHook}
            disabled={isPending}
            className="self-start text-xs font-medium text-accent hover:underline disabled:opacity-60"
          >
            + Add hook
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="text-sm font-medium">
          Body
        </label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          disabled={isPending}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cta" className="text-sm font-medium">
          Call to action
        </label>
        <input
          id="cta"
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="idea" className="text-sm font-medium">
          Free-text idea
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">
            optional
          </span>
        </label>
        <textarea
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={3}
          placeholder="Any loose notes about the direction you want"
          disabled={isPending}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? <LoadingIndicator label="Saving..." /> : "Save & continue"}
      </button>
    </div>
  );
}
