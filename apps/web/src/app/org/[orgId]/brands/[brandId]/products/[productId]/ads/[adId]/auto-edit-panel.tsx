"use client";

import { useCallback, useEffect, useState } from "react";
import { AsyncButton } from "@/components/async-button";
import { isActiveStatus, STATUS_LABEL, type AutoEditStatus } from "@/lib/auto-edit/messages";
import type { AutoEditMode } from "@/lib/auto-edit/plan-schema";
import {
  getAutoEditState,
  requestAutoEditRevision,
  restoreAutoEditCut,
  startAutoEdit,
  startTimelineFromScenes,
  type AutoEditRunView,
  type AutoEditState,
  type EditorScene,
} from "../auto-edit-actions";
import { RenderPanel } from "./render-panel";
import { TimelineEditor } from "./timeline-editor";

/**
 * Auto-edit, the timeline and rendering on the export step. Claude
 * (Designed or Clean, then the revision chat) and the editor's own
 * manual edits work on the same saved timeline, previewed live in the
 * browser; "Render MP4" and "Export project for..." run on the worker
 * from the saved version.
 *
 * Cost and time figures were measured on the production worker
 * (large-1x) with the demo cold brew ad (6 scenes, 30 s), October 2026,
 * and are labelled as estimates: they vary with the ad.
 */

const MODES: { id: AutoEditMode; name: string; look: string; captions: string; reliability: string; cost: string; time: string }[] = [
  {
    id: "designed",
    name: "Designed",
    look: "Claude designs each motion graphic for this ad: custom badges, stickers and end cards in the brand's colours.",
    captions: "Short phrases, paced closely to the script.",
    reliability: "Claude's graphic code runs in a locked-down renderer. If one can't render, that graphic switches to a Clean template automatically.",
    cost: "≈ $0.60",
    time: "≈ 5 min",
  },
  {
    id: "clean",
    name: "Clean",
    look: "Claude fills proven templates: a hook pill, callout stickers and a simple end card.",
    captions: "Full phrases, fewer on screen.",
    reliability: "Most predictable: the templates are known to render.",
    cost: "≈ $0.45",
    time: "≈ 4 min",
  },
];

const EDIT_STEPS: AutoEditStatus[] = ["queued", "planning", "rendering_preview", "reviewing", "succeeded"];
const REVISION_STEPS: AutoEditStatus[] = ["queued", "planning", "succeeded"];
const SUGGESTIONS = ["Make it punchier", "Cut scene 4", "Bigger captions", "Shorter end card"];

export function AutoEditPanel({ orgId, adId, adName }: { orgId: string; adId: string; adName: string }) {
  const [state, setState] = useState<AutoEditState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<AutoEditMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [editorStatus, setEditorStatus] = useState<{ problems: string[]; dirty: boolean }>({ problems: [], dirty: false });

  const refresh = useCallback(async () => {
    const res = await getAutoEditState(orgId, adId);
    if (!res.ok) return setLoadError(res.error);
    setLoadError(null);
    setState({ defaultMode: res.defaultMode, runs: res.runs, timeline: res.timeline, scenes: res.scenes, renders: res.renders });
  }, [orgId, adId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void refresh();
  }, [refresh]);

  const activeRun = state?.runs.find((r) => isActiveStatus(r.status)) ?? null;
  const activeRender = state?.renders.find((r) => r.status === "queued" || r.status === "rendering") ?? null;
  const polling = Boolean(activeRun || activeRender);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [polling, refresh]);

  const onProblems = useCallback((problems: string[], dirty: boolean) => {
    setEditorStatus((s) => (s.dirty === dirty && s.problems.join("\n") === problems.join("\n") ? s : { problems, dirty }));
  }, []);
  const onSaved = useCallback(() => {}, []);

  const chosenMode = mode ?? state?.defaultMode ?? "designed";
  const timeline = state?.timeline ?? null;
  const latestRun = state?.runs[0] ?? null;

  async function onStart() {
    if (timeline && !window.confirm("Auto-edit replaces the current timeline, including your manual edits. Earlier Auto-edit cuts stay in the history. Continue?")) return;
    setActionError(null);
    setStarting(true);
    const res = await startAutoEdit(orgId, adId, chosenMode);
    setStarting(false);
    if (!res.ok) return setActionError(res.error);
    await refresh();
  }

  async function onRevise(text: string) {
    if (!text.trim()) return;
    setActionError(null);
    setSending(true);
    const res = await requestAutoEditRevision(orgId, adId, text);
    setSending(false);
    if (!res.ok) return setActionError(res.error);
    setInstruction("");
    await refresh();
  }

  async function onRestore(runId: string) {
    if (!window.confirm("Put this cut back on the timeline? It replaces the current timeline; Undo won't bring your edits back.")) return;
    setActionError(null);
    const res = await restoreAutoEditCut(orgId, adId, runId);
    if (!res.ok) return setActionError(res.error);
    await refresh();
  }

  async function onStartFromScenes(scenes: EditorScene[]) {
    setActionError(null);
    setMeasuring(true);
    const durations = await measureDurations(scenes);
    const res = await startTimelineFromScenes(orgId, adId, durations);
    setMeasuring(false);
    if (!res.ok) return setActionError(res.error);
    await refresh();
  }

  const renderBlocked = !timeline
    ? "Make a timeline first."
    : activeRun
      ? "Auto-edit is working on the timeline."
      : editorStatus.dirty
        ? "Saving your edits..."
        : editorStatus.problems.length
          ? `Fix the timeline first: ${editorStatus.problems[0]}`
          : null;

  return (
    <section className="card-inset flex flex-col gap-5 p-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Edit</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Cut this ad&apos;s scene videos into a finished 1080×1920 video. Let Claude make the edit, change it by hand on the
          timeline, or both: the preview plays your edits live, and nothing is rendered until you click Render MP4.
        </p>
      </div>
      {loadError && <p className="text-sm text-danger">{loadError}</p>}
      {actionError && <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{actionError}</p>}

      {/* ---- Claude ---- */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Auto-edit with Claude</h4>
        <fieldset className="flex flex-col gap-2" disabled={Boolean(activeRun) || starting}>
          <legend className="sr-only">Mode</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((m) => (
              <label key={m.id} className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-sm transition-colors ${chosenMode === m.id ? "border-accent ring-1 ring-accent" : "border-border-strong"}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="auto-edit-mode" value={m.id} checked={chosenMode === m.id} onChange={() => setMode(m.id)} className="accent-accent" />
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-[11px] text-foreground-muted">{m.id === "designed" ? "better looking" : "cheaper, more predictable"}</span>
                </span>
                <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-foreground-muted">Look</dt><dd>{m.look}</dd>
                  <dt className="text-foreground-muted">Captions</dt><dd>{m.captions}</dd>
                  <dt className="text-foreground-muted">Reliability</dt><dd>{m.reliability}</dd>
                  <dt className="text-foreground-muted">Claude cost</dt><dd>{m.cost} per ad (estimated)</dd>
                  <dt className="text-foreground-muted">Time</dt><dd>{m.time} per ad</dd>
                </dl>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-foreground-muted">
            Estimates measured on a 30-second, 6-scene ad; each revision is about $0.20 and 2 minutes. Claude runs on your
            agency&apos;s own Anthropic key, so it shows up in your spend like other generations. Manual edits, rendering and
            exports have no Claude cost.
          </p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <AsyncButton onClick={onStart} isPending={starting} pendingLabel="Starting..." disabled={Boolean(activeRun)} className="btn-primary btn-sm">
            {timeline ? "Auto-edit again (replaces the timeline)" : "Start Auto-edit"}
          </AsyncButton>
          {activeRun && <span className="text-xs text-foreground-muted">One Auto-edit runs at a time per ad.</span>}
        </div>

        {latestRun && <RunView run={latestRun} />}

        {timeline && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground-muted">Ask Claude for changes</span>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn-secondary btn-sm" disabled={Boolean(activeRun) || sending} onClick={() => setInstruction(s)}>{s}</button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void onRevise(instruction); }}>
              <input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} placeholder={`e.g. "make it punchier" or "cut scene 4"`} className="field field-sm flex-1" disabled={Boolean(activeRun) || sending} />
              <AsyncButton type="submit" isPending={sending} pendingLabel="Sending..." disabled={Boolean(activeRun) || !instruction.trim() || editorStatus.dirty} className="btn-primary btn-sm">Revise</AsyncButton>
            </form>
            <p className="text-[11px] text-foreground-muted">
              Claude revises the timeline as it is now, your manual edits included. Fixes from its review (such as a shot cut
              for showing another brand) stay in unless you ask otherwise.
            </p>
          </div>
        )}

        {state && state.runs.length > 0 && <History runs={state.runs} currentRunId={timeline?.sourceRunId ?? null} disabled={Boolean(activeRun)} onRestore={onRestore} />}
      </div>

      {/* ---- Timeline ---- */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">Timeline</h4>
        {state && timeline ? (
          <TimelineEditor
            orgId={orgId}
            adId={adId}
            timeline={timeline}
            scenes={state.scenes}
            locked={Boolean(activeRun)}
            onSaved={onSaved}
            onReload={() => void refresh()}
            onProblems={onProblems}
          />
        ) : state ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-foreground-muted">No timeline yet. Start Auto-edit above, or lay the scenes end to end and edit them yourself.</p>
            <AsyncButton onClick={() => void onStartFromScenes(state.scenes)} isPending={measuring} disabled={Boolean(activeRun) || !state.scenes.some((s) => s.videoUrl)} className="btn-secondary btn-sm" pendingLabel="Reading the videos...">
              Start from the scenes (no Claude)
            </AsyncButton>
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">Loading...</p>
        )}
        {editorStatus.problems.length > 0 && (
          <ul className="list-disc rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 pl-6 text-xs">
            {editorStatus.problems.slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
        {timeline && timeline.findings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-foreground-muted">Claude&apos;s review of this cut ({timeline.findings.length})</summary>
            <ul className="mt-1 list-disc pl-5">
              {timeline.findings.map((i, n) => (
                <li key={n}>
                  {i.at != null && <span className="text-foreground-muted">{i.at.toFixed(1)}s · </span>}
                  {i.problem} <span className="text-foreground-muted">Fix: {i.fix}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* ---- Render & export ---- */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">Render and export</h4>
        <RenderPanel
          orgId={orgId}
          adId={adId}
          adName={adName}
          renders={state?.renders ?? []}
          blocked={renderBlocked}
          timelineVersion={timeline?.version ?? 0}
          onStarted={() => void refresh()}
        />
      </div>

      <p className="text-[10px] text-foreground-muted">Rendered with Concat and Hyperframes.</p>
    </section>
  );
}

function RunView({ run }: { run: AutoEditRunView }) {
  const steps = run.kind === "revision" ? REVISION_STEPS : EDIT_STEPS;
  const current = run.status === "fixing" ? "reviewing" : run.status;
  const idx = steps.indexOf(current);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{run.kind === "revision" ? "Revision" : "Auto-edit"} · {run.mode === "designed" ? "Designed" : "Clean"}</span>
        <span className="text-xs text-foreground-muted">{new Date(run.createdAt).toLocaleString()}</span>
        {run.claudeUsd > 0 && <span className="text-xs text-foreground-muted">Claude ${run.claudeUsd.toFixed(2)}</span>}
        {run.finishedAt && run.startedAt && (
          <span className="text-xs text-foreground-muted">{Math.round(((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60000) * 10) / 10} min</span>
        )}
      </div>
      {run.instruction && <p className="text-xs text-foreground-muted">“{run.instruction}”</p>}
      {run.status !== "failed" && run.status !== "cancelled" && (
        <ol className="flex flex-wrap gap-1.5 text-[11px]">
          {steps.map((s, i) => (
            <li key={s} className={`rounded-full border px-2 py-0.5 ${i < idx || run.status === "succeeded" ? "border-accent/40 text-foreground" : i === idx ? "border-accent bg-accent/10 font-medium" : "border-border text-foreground-muted"}`}>
              {s === "reviewing" && run.status === "fixing" ? STATUS_LABEL.fixing : STATUS_LABEL[s]}
              {s === "queued" && run.status === "queued" && run.queuePosition ? ` (#${run.queuePosition} in line)` : ""}
            </li>
          ))}
        </ol>
      )}
      {run.status === "queued" && <p className="text-xs text-foreground-muted">Waiting for a free slot. It starts automatically; you can leave this page.</p>}
      {run.status === "failed" && <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-sm text-danger">{run.error}</p>}
      {run.summary && run.status === "succeeded" && <p className="text-sm">{run.summary}</p>}
      {run.fallbacks.length > 0 && (
        <p className="text-xs text-foreground-muted">
          {run.fallbacks.length} graphic{run.fallbacks.length === 1 ? "" : "s"} used a Clean template because the designed version couldn&apos;t be rendered safely ({run.fallbacks.map((f) => f.id).join(", ")}).
        </p>
      )}
    </div>
  );
}

function History({ runs, currentRunId, disabled, onRestore }: { runs: AutoEditRunView[]; currentRunId: string | null; disabled: boolean; onRestore: (id: string) => void }) {
  const done = runs.filter((r) => r.status === "succeeded");
  if (done.length < 2 && !(done.length === 1 && done[0].id !== currentRunId)) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-foreground-muted">Earlier cuts ({done.length})</summary>
      <ol className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
        {done.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.kind === "revision" ? `“${r.instruction}”` : `Auto-edit (${r.mode === "designed" ? "Designed" : "Clean"})`}</span>
              <span className="ml-2 text-foreground-muted">{new Date(r.createdAt).toLocaleString()}</span>
            </span>
            {r.id === currentRunId ? (
              <span className="text-foreground-muted">on the timeline</span>
            ) : (
              <button type="button" className="btn-secondary btn-sm" disabled={disabled} onClick={() => onRestore(r.id)}>Load this cut</button>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Each scene video's length, read from its metadata in the browser. */
async function measureDurations(scenes: EditorScene[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(scenes.filter((s) => s.videoUrl).map((s) => new Promise<void>((resolve) => {
    const v = document.createElement("video");
    const done = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) out[String(s.index)] = v.duration;
      v.removeAttribute("src");
      resolve();
    };
    v.preload = "metadata";
    v.onloadedmetadata = done;
    v.onerror = done;
    setTimeout(done, 15000);
    v.src = s.videoUrl!;
  })));
  return out;
}
