import { clipStarts, planLength, voiceoverStarts, type EditPlan, type PlanClip } from "./plan-schema";
import { transitionLook, type TransitionStyle } from "./transitions";

/**
 * What the live preview shows at timeline time t, computed from the plan
 * the same way the render engine lays it out: clips end to end, a
 * transition centred on the cut using footage past both sides, Ken Burns
 * keys interpolated over each clip, captions and graphics at their
 * times, a separate voiceover from its scene's first clip. Pure, so the
 * preview and its tests agree with the render.
 */

export type ClipView = {
  index: number;
  scene: number;
  /** Seconds into the scene's clip to show. */
  sourceTime: number;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  volume: number;
  /** Mid-transition: how this clip is drawn on top of its Ken Burns move. */
  look?: TransitionStyle;
};

export type PreviewState = {
  t: number;
  duration: number;
  clips: ClipView[];
  captions: number[];
  /** Graphic ids on screen, with seconds into each. */
  graphics: { id: string; local: number }[];
  /** Separate voiceovers sounding, by scene, with seconds into each. */
  voiceovers: { scene: number; local: number }[];
  /** A colour over the picture (dips, flashes, light leaks). */
  wash?: { color: string; opacity: number };
};

const EASE: Record<string, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  inOut: (x) => x * x * (3 - 2 * x),
};

export function motionAt(c: PlanClip, frac: number): { scale: number; offsetX: number; offsetY: number } {
  const keys = c.motion?.keys ?? [];
  if (keys.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  if (frac <= sorted[0].at) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (frac >= last.at) return last;
  const j = sorted.findIndex((k) => k.at > frac);
  const a = sorted[j - 1];
  const b = sorted[j];
  const x = (EASE[c.motion!.ease] ?? EASE.linear)((frac - a.at) / Math.max(1e-6, b.at - a.at));
  return { scale: a.scale + (b.scale - a.scale) * x, offsetX: a.offsetX + (b.offsetX - a.offsetX) * x, offsetY: a.offsetY + (b.offsetY - a.offsetY) * x };
}

export function previewAt(plan: EditPlan, t: number, voiceoverDurations: Record<number, number> = {}): PreviewState {
  const starts = clipStarts(plan);
  const duration = planLength(plan);
  const clips: ClipView[] = [];
  let wash: PreviewState["wash"];
  // The transition live at t, if any: into clip `into`, at progress p.
  let tr: { into: number; id: string; p: number } | null = null;
  for (let i = 1; i < plan.clips.length; i++) {
    const ti = plan.clips[i].transitionIn;
    if (!ti || ti.type === "cut") continue;
    if (t >= starts[i] - ti.duration / 2 && t < starts[i] + ti.duration / 2) tr = { into: i, id: ti.type, p: (t - (starts[i] - ti.duration / 2)) / ti.duration };
  }
  const look = tr ? transitionLook(tr.id, tr.p) : null;
  if (look?.wash && look.wash.opacity > 0) wash = look.wash;
  plan.clips.forEach((c, i) => {
    const len = c.sourceOut - c.sourceIn;
    const inT = c.transitionIn && c.transitionIn.type !== "cut" && i > 0 ? c.transitionIn.duration : 0;
    const next = plan.clips[i + 1];
    const outT = next?.transitionIn && next.transitionIn.type !== "cut" ? next.transitionIn.duration : 0;
    const from = starts[i] - inT / 2;
    const to = starts[i] + len + outT / 2;
    if (t < from || t >= to) return;
    const local = t - starts[i];
    const m = motionAt(c, Math.min(1, Math.max(0, local / len)));
    const v: ClipView = { index: i, scene: c.scene, sourceTime: c.sourceIn + local, opacity: 1, ...m, volume: c.volume };
    // The incoming clip is drawn over the outgoing one, which stays underneath.
    if (tr && look && tr.into === i) {
      v.look = look.incoming;
      v.opacity = look.incoming.opacity ?? 1;
    } else if (tr && look && tr.into === i + 1) {
      v.look = look.outgoing;
      v.opacity = look.outgoing.opacity ?? 1;
    }
    clips.push(v);
  });
  clips.sort((a, b) => a.index - b.index);

  const captions = plan.captions.flatMap((c, i) => (t >= c.start && t < c.end ? [i] : []));
  const graphics = plan.graphics.filter((g) => t >= g.start && t < g.start + g.duration).map((g) => ({ id: g.id, local: t - g.start }));
  const vo = voiceoverStarts(plan);
  const voiceovers = Object.entries(voiceoverDurations)
    .map(([scene, d]) => ({ scene: Number(scene), start: vo[Number(scene)], d }))
    .filter((v) => v.start !== undefined && t >= v.start && t < v.start + v.d)
    .map((v) => ({ scene: v.scene, local: t - v.start }));
  return { t, duration, clips, captions, graphics, voiceovers, wash };
}
