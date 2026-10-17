"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { problemForEditors, renderProblems } from "@/lib/auto-edit/lint";
import { clipStarts, footageLabel, footageShortLabel, planLength, voiceoverStarts, type EditPlan, type TRANSITIONS } from "@/lib/auto-edit/plan-schema";
import { previewAt } from "@/lib/auto-edit/preview-model";
import { TRANSITION_CATALOGUE, TRANSITION_GROUPS, transitionLabel } from "@/lib/auto-edit/transitions";
import {
  addCaption, deleteCaption, deleteClip, deleteGraphic, insertClip, kenBurnsOf, moveCaption, moveClip, retimeGraphic,
  setClipVolume, setGraphicText, setKenBurns, setTransition, splitClip, trimClip, updateCaption, type KenBurns,
} from "@/lib/auto-edit/timeline-ops";
import { saveTimeline, type EditorScene, type TimelineView } from "../auto-edit-actions";
import { LivePreview } from "./live-preview";
import { MediaBin } from "./media-bin";

/**
 * The ad's timeline: the EditPlan shown as tracks (footage with trims,
 * graphics, captions, voiceover) under a live preview. Manual edits
 * without Claude: reorder, trim and split clips, cut or cross-fade, Ken
 * Burns zooms, caption text and timing, moving, retiming and deleting
 * graphics. Undo/redo, and every change autosaves to the plan, which
 * Auto-edit, the revision chat and "Render MP4" all use.
 */

type TransitionType = (typeof TRANSITIONS)[number];
type Selection = { kind: "clip"; index: number } | { kind: "caption"; index: number } | { kind: "graphic"; id: string } | null;
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type Drag = { start: number; startPlan: EditPlan; apply: (p: EditPlan, dt: number) => EditPlan };

const PREVIEW_WIDTH = 252;
const TRACK_H = 34;

export function TimelineEditor({
  orgId,
  adId,
  timeline,
  scenes: loadedScenes,
  locked,
  onSaved,
  onReload,
  onProblems,
}: {
  orgId: string;
  adId: string;
  timeline: TimelineView;
  scenes: EditorScene[];
  locked: boolean;
  onSaved: (version: number) => void;
  onReload: () => void;
  onProblems: (problems: string[], dirty: boolean) => void;
}) {
  const [plan, setPlan] = useState<EditPlan>(timeline.plan);
  const [draft, setDraft] = useState<EditPlan | null>(null);
  const [version, setVersion] = useState(timeline.version);
  const [past, setPast] = useState<EditPlan[]>([]);
  const [future, setFuture] = useState<EditPlan[]>([]);
  const [sel, setSel] = useState<Selection>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(36); // px per second
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<Record<number, number>>({});
  const [voDur, setVoDur] = useState<Record<number, number>>({});
  const drag = useRef<Drag | null>(null);
  // Clips uploaded in this session, until the next reload lists them.
  const [fresh, setFresh] = useState<EditorScene[]>([]);
  const scenes = useMemo(() => [...loadedScenes, ...fresh.filter((f) => !loadedScenes.some((s) => s.index === f.index))], [loadedScenes, fresh]);
  const shown = draft ?? plan;

  // A newer version from the server (Auto-edit, revision, restore) replaces local state.
  // Our own saves move `version` ahead of the prop, so only a higher one counts.
  if (timeline.version > version && save !== "dirty" && save !== "saving") {
    setVersion(timeline.version);
    setPlan(timeline.plan);
    setPast([]);
    setFuture([]);
    setSel(null);
  }

  const clipDurations = useMemo(() => {
    const uploaded: Record<number, number> = Object.fromEntries(scenes.flatMap((s) => (s.upload?.duration ? [[s.index, s.upload.duration]] : [])));
    return { ...uploaded, ...measured, ...timeline.clipDurations };
  }, [scenes, measured, timeline.clipDurations]);
  const duration = planLength(shown);
  const state = useMemo(() => previewAt(shown, Math.min(t, Math.max(0, duration - 1e-3)), voDur), [shown, t, duration, voDur]);
  const problemsKey = useMemo(() => renderProblems(plan, { clipDurations }).map(problemForEditors).join("\n"), [plan, clipDurations]);
  const reportProblems = useRef(onProblems);
  useEffect(() => {
    reportProblems.current = onProblems;
  });
  useEffect(() => reportProblems.current(problemsKey ? problemsKey.split("\n") : [], save !== "saved"), [problemsKey, save]);

  // ---- Edits, undo/redo, autosave ----
  const commit = useCallback((next: EditPlan) => {
    if (locked || next === plan) return;
    setPast((p) => [...p.slice(-99), plan]);
    setFuture([]);
    if (next.clips.length !== plan.clips.length || next.captions.length !== plan.captions.length) setSel(null);
    setPlan(next);
    setSave("dirty");
  }, [locked, plan]);
  const undo = useCallback(() => {
    if (!past.length || locked) return;
    setFuture((f) => [plan, ...f]);
    setPlan(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSave("dirty");
  }, [past, plan, locked]);
  const redo = useCallback(() => {
    if (!future.length || locked) return;
    setPast((p) => [...p, plan]);
    setPlan(future[0]);
    setFuture((f) => f.slice(1));
    setSave("dirty");
  }, [future, plan, locked]);

  useEffect(() => {
    if (save !== "dirty") return;
    const timer = setTimeout(async () => {
      setSave("saving");
      const res = await saveTimeline(orgId, adId, plan, version);
      if (res.ok) {
        setVersion(res.version);
        setSave((s) => (s === "saving" ? "saved" : s));
        setSaveError(null);
        onSaved(res.version);
      } else {
        setSave(res.conflict ? "conflict" : "error");
        setSaveError(res.error);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [save, plan, version, orgId, adId, onSaved]);

  // ---- Playback clock ----
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const from = t >= duration - 0.05 ? 0 : t;
    const tick = () => {
      const now = from + (performance.now() - t0) / 1000;
      if (now >= duration) {
        setT(duration);
        setPlaying(false);
        return;
      }
      setT(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts only when play starts or the length changes
  }, [playing, duration]);

  // ---- Keyboard: space, undo/redo, delete, split ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        removeSelected();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        commit(splitClip(plan, t));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function removeSelected() {
    if (!sel) return;
    if (sel.kind === "clip") commit(deleteClip(plan, sel.index));
    if (sel.kind === "caption") commit(deleteCaption(plan, sel.index));
    if (sel.kind === "graphic") commit(deleteGraphic(plan, sel.id));
    setSel(null);
  }

  // ---- Pointer drags (trims, moves, retimes): live draft, one undo step ----
  const beginDrag = (e: React.PointerEvent, apply: Drag["apply"]) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { start: e.clientX, startPlan: plan, apply };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setDraft(d.apply(d.startPlan, (e.clientX - d.start) / zoom));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft) commit(draft);
    setDraft(null);
  };

  const uploadName = (index: number) => scenes.find((s) => s.index === index)?.upload?.name;
  const starts = clipStarts(shown);
  const width = Math.max(duration, 1) * zoom + 40;
  const voStarts = voiceoverStarts(shown);
  const selectedClip = sel?.kind === "clip" ? shown.clips[sel.index] : null;
  const selectedCaption = sel?.kind === "caption" ? shown.captions[sel.index] : null;
  const selectedGraphic = sel?.kind === "graphic" ? shown.graphics.find((g) => g.id === sel.id) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <LivePreview
            plan={shown}
            scenes={scenes}
            state={state}
            playing={playing}
            width={PREVIEW_WIDTH}
            onMediaDuration={(kind, scene, s) => {
              if (!Number.isFinite(s)) return;
              if (kind === "video") setMeasured((m) => (m[scene] === s ? m : { ...m, [scene]: Math.round(s * 1000) / 1000 }));
              else setVoDur((m) => (m[scene] === s ? m : { ...m, [scene]: s }));
            }}
          />
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="btn-primary btn-sm w-16" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </button>
            <span className="tabular-nums text-foreground-muted">{fmt(t)} / {fmt(duration)}</span>
          </div>
        </div>

        <Inspector
          locked={locked}
          plan={shown}
          sel={sel}
          clipDurations={clipDurations}
          t={t}
          onCommit={commit}
          onDelete={removeSelected}
          clip={selectedClip}
          caption={selectedCaption}
          graphic={selectedGraphic}
        />
      </div>

      <MediaBin
        orgId={orgId}
        adId={adId}
        scenes={scenes}
        locked={locked}
        durations={clipDurations}
        onInsert={(index, d) => commit(insertClip(plan, t, index, d))}
        onUploaded={(scene) => {
          setFresh((f) => [...f, scene]);
          if (scene.upload) commit(insertClip(plan, t, scene.index, scene.upload.duration));
          onReload();
        }}
        onRemoved={(index) => {
          setFresh((f) => f.filter((x) => x.index !== index));
          onReload();
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="btn-secondary btn-sm" disabled={!past.length || locked} onClick={undo} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button type="button" className="btn-secondary btn-sm" disabled={!future.length || locked} onClick={redo} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <button type="button" className="btn-secondary btn-sm" disabled={locked} onClick={() => commit(splitClip(plan, t))} title="Split the clip under the playhead (S)">Split at playhead</button>
        <button type="button" className="btn-secondary btn-sm" disabled={locked} onClick={() => {
          const next = addCaption(plan, Math.min(t, Math.max(0, duration - 0.5)));
          commit(next);
          setSel({ kind: "caption", index: next.captions.findIndex((c) => c.text === "New caption" && Math.abs(c.start - Math.min(t, duration - 0.5)) < 0.01) });
        }}>Add caption</button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <label className="flex items-center gap-1 text-foreground-muted">
          Zoom
          <input type="range" min={12} max={120} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24" />
        </label>
        <span className="ml-auto text-foreground-muted">
          {locked ? "Auto-edit is working on this timeline" : save === "saved" ? "Saved" : save === "saving" ? "Saving..." : save === "dirty" ? "Unsaved changes" : ""}
        </span>
      </div>
      {(save === "error" || save === "conflict") && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
          {saveError}{" "}
          {save === "conflict" && <button type="button" className="underline" onClick={() => { setSave("saved"); onReload(); }}>Load the latest version</button>}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-background-raised" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className="relative select-none" style={{ width }}>
          <Ruler duration={duration} zoom={zoom} onSeek={(s) => { setPlaying(false); setT(Math.max(0, Math.min(duration, s))); }} />
          <Track label="Video">
            {shown.clips.map((c, i) => {
              const len = c.sourceOut - c.sourceIn;
              const selected = sel?.kind === "clip" && sel.index === i;
              const dur = clipDurations[c.scene] ?? c.sourceOut;
              return (
                <div
                  key={`${i}-${c.scene}-${c.sourceIn}`}
                  draggable={!locked}
                  onDragStart={(e) => e.dataTransfer.setData("text/autocut-clip", String(i))}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const from = Number(e.dataTransfer.getData("text/autocut-clip"));
                    if (Number.isInteger(from)) commit(moveClip(plan, from, i));
                  }}
                  onClick={() => setSel({ kind: "clip", index: i })}
                  className={`absolute top-1 flex h-[26px] items-center overflow-hidden rounded border px-1.5 text-[10px] font-medium ${selected ? "border-accent bg-accent/25" : "border-sky-500/50 bg-sky-500/20"}`}
                  style={{ left: starts[i] * zoom, width: Math.max(4, len * zoom - 1) }}
                  title={`${footageLabel(c.scene)}${uploadName(c.scene) ? ` (${uploadName(c.scene)})` : ""}: ${c.sourceIn.toFixed(2)}-${c.sourceOut.toFixed(2)} s of the clip. Drag to reorder.`}
                >
                  {c.transitionIn && <span className="mr-1 text-foreground-muted" title={transitionLabel(c.transitionIn.type)}>⧓</span>}
                  <span className="truncate">{footageShortLabel(c.scene)}{c.motion ? " · KB" : ""}</span>
                  <Handle side="left" onPointerDown={(e) => beginDrag(e, (p, dt) => trimClip(p, i, "in", p.clips[i].sourceIn + dt, dur))} />
                  <Handle side="right" onPointerDown={(e) => beginDrag(e, (p, dt) => trimClip(p, i, "out", p.clips[i].sourceOut + dt, dur))} />
                </div>
              );
            })}
          </Track>
          {(["overlay", "fullFrame"] as const).map((layout) => (
            <Track key={layout} label={layout === "overlay" ? "Graphics" : "Cards"}>
              {shown.graphics.filter((g) => g.layout === layout).map((g) => {
                const selected = sel?.kind === "graphic" && sel.id === g.id;
                return (
                  <div
                    key={g.id}
                    onClick={() => setSel({ kind: "graphic", id: g.id })}
                    onPointerDown={(e) => beginDrag(e, (p, dt) => {
                      const o = p.graphics.find((x) => x.id === g.id)!;
                      return retimeGraphic(p, g.id, o.start + dt, o.duration);
                    })}
                    className={`absolute top-1 flex h-[26px] cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] font-medium ${selected ? "border-accent bg-accent/25" : "border-violet-500/50 bg-violet-500/20"}`}
                    style={{ left: g.start * zoom, width: Math.max(4, g.duration * zoom - 1) }}
                    title={`${g.id}: ${g.start.toFixed(2)} s for ${g.duration.toFixed(2)} s. Drag to move.`}
                  >
                    <span className="truncate">{g.id}{g.code ? "" : " (template)"}</span>
                    <Handle side="right" onPointerDown={(e) => beginDrag(e, (p, dt) => {
                      const o = p.graphics.find((x) => x.id === g.id)!;
                      return retimeGraphic(p, g.id, o.start, o.duration + dt);
                    })} />
                  </div>
                );
              })}
            </Track>
          ))}
          <Track label="Captions">
            {shown.captions.map((c, i) => {
              const selected = sel?.kind === "caption" && sel.index === i;
              return (
                <div
                  key={`${i}-${c.start}`}
                  onClick={() => setSel({ kind: "caption", index: i })}
                  onPointerDown={(e) => beginDrag(e, (p, dt) => moveCaption(p, i, p.captions[i].start + dt))}
                  className={`absolute top-1 flex h-[26px] cursor-grab items-center overflow-hidden rounded border px-1 text-[10px] ${selected ? "border-accent bg-accent/25" : "border-amber-500/50 bg-amber-500/15"}`}
                  style={{ left: c.start * zoom, width: Math.max(4, (c.end - c.start) * zoom - 1) }}
                  title={c.text}
                >
                  <Handle side="left" onPointerDown={(e) => beginDrag(e, (p, dt) => updateCaption(p, i, { start: p.captions[i].start + dt }))} />
                  <span className="truncate">{c.text}</span>
                  <Handle side="right" onPointerDown={(e) => beginDrag(e, (p, dt) => updateCaption(p, i, { end: p.captions[i].end + dt }))} />
                </div>
              );
            })}
          </Track>
          <Track label="Voiceover">
            {scenes.filter((s) => s.voiceoverUrl).map((s) => {
              const at = voStarts[s.index];
              if (at === undefined) return null;
              const d = voDur[s.index] ?? 2;
              return (
                <div key={s.index} className="absolute top-1 flex h-[26px] items-center overflow-hidden rounded border border-emerald-500/50 bg-emerald-500/15 px-1 text-[10px]" style={{ left: at * zoom, width: Math.max(4, d * zoom - 1) }}>
                  <span className="truncate">VO S{s.index + 1}{s.voiceoverMode === "inClip" ? " (in clip)" : ""}</span>
                </div>
              );
            })}
          </Track>
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500" style={{ left: 64 + t * zoom }} />
        </div>
      </div>
      <p className="text-[11px] text-foreground-muted">
        Drag a clip onto another to reorder it; drag edges to trim or retime; drag graphics and captions to move them. Space plays, S splits at the playhead, Delete removes the selection.
      </p>
    </div>
  );
}

function Track({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative flex border-t border-border" style={{ height: TRACK_H }}>
      <div className="sticky left-0 z-10 flex w-16 shrink-0 items-center bg-background-raised px-2 text-[10px] font-medium text-foreground-muted">{label}</div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function Ruler({ duration, zoom, onSeek }: { duration: number; zoom: number; onSeek: (t: number) => void }) {
  const step = zoom < 20 ? 5 : zoom < 50 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  return (
    <div className="relative flex h-6" onPointerDown={(e) => {
      const r = (e.currentTarget.lastChild as HTMLElement).getBoundingClientRect();
      onSeek((e.clientX - r.left) / zoom);
    }}>
      <div className="w-16 shrink-0" />
      <div className="relative flex-1 cursor-pointer">
        {ticks.map((s) => (
          <span key={s} className="absolute top-1 text-[9px] text-foreground-muted" style={{ left: s * zoom }}>
            {s}s
          </span>
        ))}
      </div>
    </div>
  );
}

function Handle({ side, onPointerDown }: { side: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={`absolute top-0 h-full w-1.5 cursor-ew-resize bg-foreground/30 hover:bg-accent ${side === "left" ? "left-0" : "right-0"}`}
    />
  );
}

function Inspector({
  locked, plan, sel, clipDurations, t, onCommit, onDelete, clip, caption, graphic,
}: {
  locked: boolean;
  plan: EditPlan;
  sel: Selection;
  clipDurations: Record<number, number>;
  t: number;
  onCommit: (p: EditPlan) => void;
  onDelete: () => void;
  clip: EditPlan["clips"][number] | null;
  caption: EditPlan["captions"][number] | null;
  graphic: EditPlan["graphics"][number] | null;
}) {
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  return (
    <fieldset disabled={locked} className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border p-3 text-xs">
      {!sel && <p className="text-foreground-muted">Select a clip, caption or graphic on the timeline to edit it.</p>}

      {sel?.kind === "clip" && clip && (
        <>
          <div className="font-medium">Clip {sel.index + 1}: {footageLabel(clip.scene).toLowerCase()}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">In (s)
              <input type="number" step={0.1} className="field field-sm" value={clip.sourceIn} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(trimClip(plan, sel.index, "in", v, clipDurations[clip.scene] ?? clip.sourceOut)); }} />
            </label>
            <label className="flex flex-col gap-1">Out (s)
              <input type="number" step={0.1} className="field field-sm" value={clip.sourceOut} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(trimClip(plan, sel.index, "out", v, clipDurations[clip.scene] ?? clip.sourceOut)); }} />
            </label>
            <label className="flex flex-col gap-1">Transition in
              <select className="field field-sm" disabled={sel.index === 0} value={clip.transitionIn?.type ?? "cut"} onChange={(e) => onCommit(setTransition(plan, sel.index, e.target.value as TransitionType, clip.transitionIn?.duration ?? 0.5))}>
                <option value="cut">Cut</option>
                {TRANSITION_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {TRANSITION_CATALOGUE.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">Transition length (s)
              <input type="number" step={0.1} min={0.1} max={2} className="field field-sm" disabled={!clip.transitionIn} value={clip.transitionIn?.duration ?? 0.5} onChange={(e) => { const v = num(e.target.value); if (v > 0 && clip.transitionIn) onCommit(setTransition(plan, sel.index, clip.transitionIn.type, v)); }} />
            </label>
            <label className="flex flex-col gap-1">Ken Burns
              <select className="field field-sm" value={kenBurnsOf(clip)} onChange={(e) => onCommit(setKenBurns(plan, sel.index, e.target.value as KenBurns))}>
                <option value="none">None</option>
                <option value="zoomIn">Zoom in</option>
                <option value="zoomOut">Zoom out</option>
                <option value="panLeft">Pan left</option>
                <option value="panRight">Pan right</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">Clip volume
              <input type="range" min={0} max={1} step={0.05} value={clip.volume} onChange={(e) => onCommit(setClipVolume(plan, sel.index, Number(e.target.value)))} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => onCommit(splitClip(plan, t))}>Split at playhead</button>
            <button type="button" className="btn-secondary btn-sm text-danger" disabled={plan.clips.length <= 1} onClick={onDelete}>Delete clip</button>
          </div>
        </>
      )}

      {sel?.kind === "caption" && caption && (
        <>
          <div className="font-medium">Caption</div>
          <textarea className="field field-sm min-h-14" value={caption.text} onChange={(e) => onCommit(updateCaption(plan, sel.index, { text: e.target.value }))} maxLength={200} />
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">Start (s)
              <input type="number" step={0.1} className="field field-sm" value={caption.start} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(updateCaption(plan, sel.index, { start: v })); }} />
            </label>
            <label className="flex flex-col gap-1">End (s)
              <input type="number" step={0.1} className="field field-sm" value={caption.end} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(updateCaption(plan, sel.index, { end: v })); }} />
            </label>
            <label className="flex flex-col gap-1">Style
              <select className="field field-sm" value={caption.style} onChange={(e) => onCommit(updateCaption(plan, sel.index, { style: e.target.value }))}>
                {plan.captionStyles.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={caption.popIn} onChange={(e) => onCommit(updateCaption(plan, sel.index, { popIn: e.target.checked }))} /> Pop in</label>
            <button type="button" className="btn-secondary btn-sm ml-auto text-danger" onClick={onDelete}>Delete caption</button>
          </div>
        </>
      )}

      {sel?.kind === "graphic" && graphic && (
        <>
          <div className="font-medium">Graphic {graphic.id} · {graphic.layout === "overlay" ? "overlay" : "full-frame card"}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">Start (s)
              <input type="number" step={0.1} className="field field-sm" value={graphic.start} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(retimeGraphic(plan, graphic.id, v, graphic.duration)); }} />
            </label>
            <label className="flex flex-col gap-1">Length (s)
              <input type="number" step={0.1} className="field field-sm" value={graphic.duration} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) onCommit(retimeGraphic(plan, graphic.id, graphic.start, v)); }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(graphic.template.name === "callout" ? (["text", "accent"] as const) : graphic.template.name === "hookPill" ? (["headline", "sub", "accent"] as const) : (["headline", "sub", "cta", "bg", "accent"] as const)).map((k) => (
              <label key={k} className="flex flex-col gap-1">{k}
                <input className="field field-sm" value={graphic.template.props[k]} onChange={(e) => onCommit(setGraphicText(plan, graphic.id, { [k]: e.target.value }))} />
              </label>
            ))}
          </div>
          {graphic.code && <p className="text-[11px] text-foreground-muted">This is a Designed graphic: its look and wording are in its code. These fields change its Clean template, used if the design can&apos;t render.</p>}
          <button type="button" className="btn-secondary btn-sm self-start text-danger" onClick={onDelete}>Delete graphic</button>
        </>
      )}
    </fieldset>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
