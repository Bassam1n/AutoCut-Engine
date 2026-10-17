import { clipStarts, planLength, type EditPlan, type PlanClip } from "./plan-schema";

/**
 * The timeline editor's manual edits, as pure functions from plan to plan
 * (the editor keeps the old plans for undo). Clip edits carry the
 * captions and graphics that sit on a clip along with it, and keep
 * whatever runs after the footage (the end card) at the end, so a
 * reorder or trim doesn't leave text over the wrong shot.
 */

export const MIN_CLIP_SECONDS = 0.5;
export const MIN_CAPTION_SECONDS = 0.4;
export const MIN_GRAPHIC_SECONDS = 0.5;

export type KenBurns = "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight";

const round = (n: number) => Math.round(n * 1000) / 1000;
const clone = (p: EditPlan): EditPlan => structuredClone(p);

/** Which clip each caption and graphic starts in (-1: after the footage). */
function anchors(plan: EditPlan) {
  const starts = clipStarts(plan);
  const end = starts.length ? starts.at(-1)! + (plan.clips.at(-1)!.sourceOut - plan.clips.at(-1)!.sourceIn) : 0;
  const at = (t: number) => {
    if (t >= end - 1e-3) return -1;
    let idx = 0;
    starts.forEach((s, i) => {
      if (t >= s - 1e-3) idx = i;
    });
    return idx;
  };
  return { starts, end, captions: plan.captions.map((c) => at(c.start)), graphics: plan.graphics.map((g) => at(g.start)) };
}

/**
 * Applies a clip edit, then moves each caption and graphic by however
 * much the start of its clip moved (`mapClip` gives each old clip's new
 * index, or null when it was removed) and keeps the after-footage tail
 * at the end.
 */
function withAnchored(plan: EditPlan, edit: (p: EditPlan) => void, mapClip: (oldIndex: number) => number | null): EditPlan {
  const before = anchors(plan);
  const next = clone(plan);
  edit(next);
  const starts = clipStarts(next);
  const lastEnd = starts.length ? starts.at(-1)! + (next.clips.at(-1)!.sourceOut - next.clips.at(-1)!.sourceIn) : 0;
  const shift = (anchor: number) => {
    if (anchor === -1) return lastEnd - before.end;
    const ni = mapClip(anchor);
    return ni == null ? 0 : starts[ni] - before.starts[anchor];
  };
  next.captions.forEach((c, i) => {
    const d = shift(before.captions[i]);
    c.start = round(Math.max(0, c.start + d));
    c.end = round(Math.max(c.start + MIN_CAPTION_SECONDS, c.end + d));
  });
  next.graphics.forEach((g, i) => {
    g.start = round(Math.max(0, g.start + shift(before.graphics[i])));
  });
  next.captions.sort((a, b) => a.start - b.start);
  // Clips that got shorter pull later captions onto earlier ones: end each where the next begins.
  for (let i = 1; i < next.captions.length; i++) {
    const prev = next.captions[i - 1];
    const c = next.captions[i];
    if (c.start >= prev.end) continue;
    prev.end = round(Math.max(prev.start + MIN_CAPTION_SECONDS, c.start));
    if (c.start < prev.end) {
      const len = c.end - c.start;
      c.start = prev.end;
      c.end = round(c.start + Math.max(MIN_CAPTION_SECONDS, len));
    }
  }
  return next;
}

export function moveClip(plan: EditPlan, from: number, to: number): EditPlan {
  if (from === to || from < 0 || to < 0 || from >= plan.clips.length || to >= plan.clips.length) return plan;
  const order = plan.clips.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const next = withAnchored(plan, (p) => {
    p.clips = order.map((i) => structuredClone(plan.clips[i]));
  }, (old) => order.indexOf(old));
  // A clip moved to the front can't keep a transition in.
  if (next.clips[0].transitionIn) next.clips[0].transitionIn = null;
  return next;
}

/** Moves a clip's in or out point to a new source time, within its footage. */
export function trimClip(plan: EditPlan, i: number, edge: "in" | "out", sourceTime: number, clipDuration: number): EditPlan {
  const c = plan.clips[i];
  if (!c) return plan;
  return withAnchored(plan, (p) => {
    const k = p.clips[i];
    if (edge === "in") k.sourceIn = round(Math.min(Math.max(0, sourceTime), k.sourceOut - MIN_CLIP_SECONDS));
    else k.sourceOut = round(Math.max(Math.min(clipDuration, sourceTime), k.sourceIn + MIN_CLIP_SECONDS));
  }, (old) => old);
}

/** Splits the clip under timeline time t into two shots. */
export function splitClip(plan: EditPlan, t: number): EditPlan {
  const starts = clipStarts(plan);
  const i = starts.findIndex((s, k) => t > s + MIN_CLIP_SECONDS - 1e-6 && t < s + (plan.clips[k].sourceOut - plan.clips[k].sourceIn) - MIN_CLIP_SECONDS + 1e-6);
  if (i < 0) return plan;
  const next = clone(plan);
  const c = next.clips[i];
  const cut = round(c.sourceIn + (t - starts[i]));
  const tail: PlanClip = { ...structuredClone(c), sourceIn: cut, transitionIn: null };
  c.sourceOut = cut;
  next.clips.splice(i + 1, 0, tail);
  return next;
}

export function deleteClip(plan: EditPlan, i: number): EditPlan {
  if (plan.clips.length <= 1 || !plan.clips[i]) return plan;
  const next = withAnchored(plan, (p) => {
    p.clips.splice(i, 1);
  }, (old) => (old === i ? null : old > i ? old - 1 : old));
  if (next.clips[0].transitionIn) next.clips[0].transitionIn = null;
  return next;
}

export function setTransition(plan: EditPlan, i: number, type: "cut" | "cross-fade", duration = 0.4): EditPlan {
  if (i <= 0 || !plan.clips[i]) return plan;
  const next = clone(plan);
  next.clips[i].transitionIn = type === "cut" ? null : { type: "cross-fade", duration: round(duration) };
  return next;
}

export function kenBurnsOf(c: PlanClip): KenBurns {
  const k = c.motion?.keys;
  if (!k || k.length < 2) return "none";
  const [a, b] = [k[0], k[k.length - 1]];
  if (b.offsetX < a.offsetX - 1e-3) return "panLeft";
  if (b.offsetX > a.offsetX + 1e-3) return "panRight";
  return b.scale >= a.scale ? "zoomIn" : "zoomOut";
}

/** Ken Burns presets, all within the lint's edge rule (|offset| <= (scale-1)/2). */
export function setKenBurns(plan: EditPlan, i: number, preset: KenBurns): EditPlan {
  if (!plan.clips[i]) return plan;
  const next = clone(plan);
  const key = (at: number, scale: number, offsetX = 0) => ({ at, scale, offsetX, offsetY: 0 });
  next.clips[i].motion =
    preset === "none" ? null
    : preset === "zoomIn" ? { ease: "inOut", keys: [key(0, 1), key(1, 1.12)] }
    : preset === "zoomOut" ? { ease: "inOut", keys: [key(0, 1.12), key(1, 1)] }
    : preset === "panLeft" ? { ease: "linear", keys: [key(0, 1.12, 0.05), key(1, 1.12, -0.05)] }
    : { ease: "linear", keys: [key(0, 1.12, -0.05), key(1, 1.12, 0.05)] };
  return next;
}

export function setClipVolume(plan: EditPlan, i: number, volume: number): EditPlan {
  if (!plan.clips[i]) return plan;
  const next = clone(plan);
  next.clips[i].volume = round(Math.min(1, Math.max(0, volume)));
  return next;
}

// ---- Captions ----

export function updateCaption(plan: EditPlan, i: number, patch: Partial<{ text: string; start: number; end: number; style: string; popIn: boolean }>): EditPlan {
  if (!plan.captions[i]) return plan;
  const next = clone(plan);
  const c = next.captions[i];
  Object.assign(c, patch);
  c.start = round(Math.max(0, c.start));
  c.end = round(Math.max(c.start + MIN_CAPTION_SECONDS, c.end));
  next.captions.sort((a, b) => a.start - b.start);
  return next;
}

/** Moves a caption keeping its length. */
export function moveCaption(plan: EditPlan, i: number, start: number): EditPlan {
  const c = plan.captions[i];
  if (!c) return plan;
  const len = c.end - c.start;
  return updateCaption(plan, i, { start: Math.max(0, start), end: Math.max(0, start) + len });
}

export function addCaption(plan: EditPlan, at: number, text = "New caption"): EditPlan {
  const next = clone(plan);
  if (!next.captionStyles.length) {
    next.captionStyles.push({ name: "main", fontSize: 0.042, fontWeight: 800, color: "#ffffff", background: "", strokeWidth: 0.003, strokeColor: "#000000", maxWidth: 0.86, offsetY: 0.28 });
  }
  const later = next.captions.find((c) => c.start > at + 1e-3);
  const end = Math.min(at + 2, later ? later.start : at + 2, planLength(plan));
  next.captions.push({ start: round(at), end: round(Math.max(end, at + MIN_CAPTION_SECONDS)), text, style: next.captionStyles[0].name, popIn: true });
  next.captions.sort((a, b) => a.start - b.start);
  return next;
}

export function deleteCaption(plan: EditPlan, i: number): EditPlan {
  if (!plan.captions[i]) return plan;
  const next = clone(plan);
  next.captions.splice(i, 1);
  return next;
}

// ---- Graphics ----

export function retimeGraphic(plan: EditPlan, id: string, start: number, duration: number): EditPlan {
  const i = plan.graphics.findIndex((g) => g.id === id);
  if (i < 0) return plan;
  const next = clone(plan);
  next.graphics[i].start = round(Math.max(0, start));
  next.graphics[i].duration = round(Math.max(MIN_GRAPHIC_SECONDS, duration));
  return next;
}

export function deleteGraphic(plan: EditPlan, id: string): EditPlan {
  const next = clone(plan);
  next.graphics = next.graphics.filter((g) => g.id !== id);
  // An end card hold with no full-frame card left would be black.
  if (!next.graphics.some((g) => g.layout === "fullFrame")) next.endCardHold = 0;
  return next;
}

export function setGraphicText(plan: EditPlan, id: string, props: Partial<EditPlan["graphics"][number]["template"]["props"]>): EditPlan {
  const i = plan.graphics.findIndex((g) => g.id === id);
  if (i < 0) return plan;
  const next = clone(plan);
  Object.assign(next.graphics[i].template.props, props);
  return next;
}

/** A first timeline without Claude: every scene end to end, the script as captions. */
export function planFromScenes(scenes: { index: number; copy: string }[], durations: Record<number, number>): EditPlan {
  const clips = scenes
    .filter((s) => (durations[s.index] ?? 0) >= MIN_CLIP_SECONDS)
    .map((s) => ({ scene: s.index, sourceIn: 0, sourceOut: round(durations[s.index]), transitionIn: null, motion: null, volume: 1 }));
  const captions: EditPlan["captions"] = [];
  let t = 0;
  for (const c of clips) {
    const copy = scenes.find((s) => s.index === c.scene)?.copy ?? "";
    const parts = copy.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    const len = c.sourceOut - c.sourceIn;
    const words = parts.map((p) => p.split(/\s+/).length);
    const total = words.reduce((a, b) => a + b, 0) || 1;
    let at = t;
    parts.forEach((p, k) => {
      const d = (len * words[k]) / total;
      captions.push({ start: round(at), end: round(at + d), text: p, style: "main", popIn: false });
      at += d;
    });
    t += len;
  }
  return {
    summary: "Every scene end to end, with the script as captions.",
    clips,
    captionStyles: [{ name: "main", fontSize: 0.04, fontWeight: 800, color: "#ffffff", background: "", strokeWidth: 0.003, strokeColor: "#000000", maxWidth: 0.86, offsetY: 0.28 }],
    captions,
    graphics: [],
    endCardHold: 0,
  };
}
