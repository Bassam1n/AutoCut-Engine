"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AsyncButton } from "@/components/async-button";
import { isActiveStatus, STATUS_LABEL, type AutoEditStatus } from "@/lib/auto-edit/messages";
import type { AutoEditMode } from "@/lib/auto-edit/plan-schema";
import {
  getAutoEditState,
  requestAutoEditRevision,
  startAutoEdit,
  type AutoEditRunView,
  type AutoEditState,
} from "../auto-edit-actions";

/**
 * Auto-edit on the export step: Claude cuts the finished scene videos
 * into the final 1080x1920 ad. The editor picks a mode (the info card
 * compares them), starts it, watches the steps, plays the preview and
 * the final cut, and asks for changes in plain words.
 *
 * Cost and time figures come from the labs proof on the demo cold brew
 * ad (6 scenes, 30 s) and are labelled as estimates.
 */

const MODES: { id: AutoEditMode; name: string; look: string; captions: string; reliability: string; cost: string; time: string }[] = [
  {
    id: "designed",
    name: "Designed",
    look: "Claude designs each motion graphic for this ad: custom badges, stickers and end cards in the brand's colours.",
    captions: "Short phrases, paced closely to the script.",
    reliability: "Claude's graphic code runs in a locked-down renderer. If one can't render, that graphic switches to a Clean template automatically.",
    cost: "≈ $0.42",
    time: "≈ 6 min",
  },
  {
    id: "clean",
    name: "Clean",
    look: "Claude fills proven templates: a hook pill, callout stickers and a simple end card.",
    captions: "Full phrases, fewer on screen.",
    reliability: "Most predictable: the templates are known to render.",
    cost: "≈ $0.31",
    time: "≈ 5 min",
  },
];

const EDIT_STEPS: AutoEditStatus[] = ["queued", "planning", "rendering_preview", "reviewing", "rendering_final", "succeeded"];
const REVISION_STEPS: AutoEditStatus[] = ["queued", "planning", "rendering_final", "succeeded"];

const SUGGESTIONS = ["Make it punchier", "Cut scene 4", "Bigger captions", "Shorter end card"];

export function AutoEditPanel({ orgId, adId }: { orgId: string; adId: string }) {
  const [state, setState] = useState<AutoEditState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<AutoEditMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await getAutoEditState(orgId, adId);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setState({ defaultMode: res.defaultMode, runs: res.runs });
  }, [orgId, adId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void refresh();
  }, [refresh]);

  const active = state?.runs.find((r) => isActiveStatus(r.status)) ?? null;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const chosenMode = mode ?? state?.defaultMode ?? "designed";
  const latestDone = state?.runs.find((r) => r.status === "succeeded") ?? null;
  const shown = useMemo(() => {
    if (!state?.runs.length) return null;
    return state.runs.find((r) => r.id === selectedId) ?? active ?? state.runs[0];
  }, [state, selectedId, active]);

  async function onStart() {
    setActionError(null);
    setStarting(true);
    const res = await startAutoEdit(orgId, adId, chosenMode);
    setStarting(false);
    if (!res.ok) return setActionError(res.error);
    setSelectedId(null);
    await refresh();
  }

  async function onRevise(text: string) {
    if (!latestDone || !text.trim()) return;
    setActionError(null);
    setSending(true);
    const res = await requestAutoEditRevision(orgId, adId, latestDone.id, text);
    setSending(false);
    if (!res.ok) return setActionError(res.error);
    setInstruction("");
    setSelectedId(null);
    await refresh();
  }

  return (
    <section className="card-inset flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Auto-edit</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Claude cuts this ad&apos;s scene videos into a finished 1080×1920 MP4: shot choice and timing, captions, motion
          graphics and an end card. It renders a preview, reviews it, fixes what it finds, then renders the final video.
        </p>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      <fieldset className="flex flex-col gap-2" disabled={Boolean(active) || starting}>
        <legend className="mb-2 text-xs font-medium text-foreground-muted">Mode</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-sm transition-colors ${
                chosenMode === m.id ? "border-accent ring-1 ring-accent" : "border-border-strong"
              }`}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="auto-edit-mode" value={m.id} checked={chosenMode === m.id} onChange={() => setMode(m.id)} className="accent-accent" />
                <span className="font-semibold">{m.name}</span>
                {m.id === "designed" && <span className="text-[11px] text-foreground-muted">better looking</span>}
                {m.id === "clean" && <span className="text-[11px] text-foreground-muted">cheaper, more predictable</span>}
              </span>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-foreground-muted">Look</dt>
                <dd>{m.look}</dd>
                <dt className="text-foreground-muted">Captions</dt>
                <dd>{m.captions}</dd>
                <dt className="text-foreground-muted">Reliability</dt>
                <dd>{m.reliability}</dd>
                <dt className="text-foreground-muted">Claude cost</dt>
                <dd>{m.cost} per ad (estimated)</dd>
                <dt className="text-foreground-muted">Time</dt>
                <dd>{m.time} per ad</dd>
              </dl>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-foreground-muted">
          Costs are estimates from a 30-second, 6-scene test ad; each revision is about $0.12 and 3 minutes. Claude runs on
          your agency&apos;s own Anthropic key, so it shows up in your spend like other generations. Rendering is included.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <AsyncButton onClick={onStart} isPending={starting} pendingLabel="Starting..." disabled={Boolean(active)} className="btn-primary btn-sm">
          {latestDone ? "Start a new Auto-edit" : "Start Auto-edit"}
        </AsyncButton>
        {active && <span className="text-xs text-foreground-muted">One Auto-edit runs at a time per ad.</span>}
      </div>
      {actionError && <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{actionError}</p>}

      {shown && <RunView run={shown} />}

      {latestDone && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-xs font-medium text-foreground-muted">Ask for changes</span>
          <RevisionThread runs={state!.runs} onSelect={setSelectedId} selectedId={shown?.id ?? null} />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="btn-secondary btn-sm" disabled={Boolean(active) || sending} onClick={() => setInstruction(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onRevise(instruction);
            }}
          >
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={2000}
              placeholder={`e.g. "make it punchier" or "cut scene 4"`}
              className="field field-sm flex-1"
              disabled={Boolean(active) || sending}
            />
            <AsyncButton type="submit" isPending={sending} pendingLabel="Sending..." disabled={Boolean(active) || !instruction.trim()} className="btn-primary btn-sm">
              Revise
            </AsyncButton>
          </form>
          <p className="text-[11px] text-foreground-muted">
            Revises the latest finished cut. Fixes from its review (such as a shot cut for showing another brand) stay in
            unless you ask otherwise.
          </p>
        </div>
      )}

      <p className="text-[10px] text-foreground-muted">Rendered with Concat and Hyperframes.</p>
    </section>
  );
}

function RunView({ run }: { run: AutoEditRunView }) {
  const steps = run.kind === "revision" ? REVISION_STEPS : EDIT_STEPS;
  const current = run.status === "fixing" ? "reviewing" : run.status;
  const idx = steps.indexOf(current);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{run.kind === "revision" ? "Revision" : "Auto-edit"} · {run.mode === "designed" ? "Designed" : "Clean"}</span>
        <span className="text-xs text-foreground-muted">{new Date(run.createdAt).toLocaleString()}</span>
        {run.claudeUsd > 0 && <span className="text-xs text-foreground-muted">Claude ${run.claudeUsd.toFixed(2)}</span>}
        {run.finishedAt && run.startedAt && (
          <span className="text-xs text-foreground-muted">{Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60000 * 10) / 10} min</span>
        )}
      </div>
      {run.instruction && <p className="text-xs text-foreground-muted">“{run.instruction}”</p>}

      {run.status !== "failed" && run.status !== "cancelled" && (
        <ol className="flex flex-wrap gap-1.5 text-[11px]">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`rounded-full border px-2 py-0.5 ${
                i < idx || run.status === "succeeded" ? "border-accent/40 text-foreground" : i === idx ? "border-accent bg-accent/10 font-medium" : "border-border text-foreground-muted"
              }`}
            >
              {s === "reviewing" && run.status === "fixing" ? STATUS_LABEL.fixing : STATUS_LABEL[s]}
              {s === "queued" && run.status === "queued" && run.queuePosition ? ` (#${run.queuePosition} in line)` : ""}
            </li>
          ))}
        </ol>
      )}
      {run.status === "queued" && (
        <p className="text-xs text-foreground-muted">Waiting for a free render slot. It starts automatically; you can leave this page.</p>
      )}
      {run.status === "failed" && <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{run.error}</p>}
      {isActiveStatus(run.status) && run.error && <p className="text-xs text-foreground-muted">{run.error}</p>}

      {run.summary && <p className="text-sm">{run.summary}</p>}

      <div className="flex flex-wrap gap-4">
        {run.finalUrl ? (
          <figure className="flex flex-col gap-1">
            <video src={run.finalUrl} controls playsInline className="h-96 w-auto rounded-lg border border-border-strong bg-black" />
            <figcaption className="flex items-center gap-3 text-xs">
              <span className="text-foreground-muted">Final · 1080×1920</span>
              {run.finalDownloadUrl && (
                <a href={run.finalDownloadUrl} className="btn-primary btn-sm">
                  Download MP4
                </a>
              )}
            </figcaption>
          </figure>
        ) : null}
        {run.previewUrl && (
          <figure className="flex flex-col gap-1">
            <video src={run.previewUrl} controls playsInline className={`${run.finalUrl ? "h-48" : "h-96"} w-auto rounded-lg border border-border bg-black`} />
            <figcaption className="text-xs text-foreground-muted">Preview (low resolution, before the review fixes)</figcaption>
          </figure>
        )}
      </div>

      {run.reviewVerdict && (
        <details className="text-xs">
          <summary className="cursor-pointer text-foreground-muted">
            Claude&apos;s review: {run.reviewVerdict === "ship" ? "ready to ship" : `${run.reviewIssues.length} fix${run.reviewIssues.length === 1 ? "" : "es"} made before the final render`}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {run.reviewIssues.map((i, n) => (
              <li key={n}>
                {i.at != null && <span className="text-foreground-muted">{i.at.toFixed(1)}s · </span>}
                {i.problem} <span className="text-foreground-muted">Fix: {i.fix}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {run.fallbacks.length > 0 && (
        <p className="text-xs text-foreground-muted">
          {run.fallbacks.length} graphic{run.fallbacks.length === 1 ? "" : "s"} used a Clean template because the designed version couldn&apos;t be rendered
          safely ({run.fallbacks.map((f) => f.id).join(", ")}).
        </p>
      )}
    </div>
  );
}

function RevisionThread({ runs, onSelect, selectedId }: { runs: AutoEditRunView[]; onSelect: (id: string) => void; selectedId: string | null }) {
  const ordered = [...runs].reverse();
  if (ordered.length < 2) return null;
  return (
    <ol className="flex max-h-56 flex-col gap-1.5 overflow-y-auto text-xs">
      {ordered.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className={`w-full rounded-lg border px-2 py-1.5 text-left ${selectedId === r.id ? "border-accent" : "border-border"}`}
          >
            <span className="font-medium">{r.kind === "revision" ? `“${r.instruction}”` : `Auto-edit (${r.mode === "designed" ? "Designed" : "Clean"})`}</span>
            <span className="ml-2 text-foreground-muted">{STATUS_LABEL[r.status]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
