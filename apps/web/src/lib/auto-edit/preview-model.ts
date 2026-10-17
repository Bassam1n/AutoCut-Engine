import { clipStarts, planLength, voiceoverStarts, type EditPlan, type PlanClip } from "./plan-schema";

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
  const view = (i: number, opacity: number) => {
    const c = plan.clips[i];
    const len = c.sourceOut - c.sourceIn;
    const local = t - starts[i];
    const m = motionAt(c, Math.min(1, Math.max(0, local / len)));
    clips.push({ index: i, scene: c.scene, sourceTime: c.sourceIn + local, opacity, ...m, volume: c.volume });
  };
  plan.clips.forEach((c, i) => {
    const len = c.sourceOut - c.sourceIn;
    const inT = c.transitionIn && c.transitionIn.type !== "cut" && i > 0 ? c.transitionIn.duration : 0;
    const next = plan.clips[i + 1];
    const outT = next?.transitionIn && next.transitionIn.type !== "cut" ? next.transitionIn.duration : 0;
    const from = starts[i] - inT / 2;
    const to = starts[i] + len + outT / 2;
    if (t < from || t >= to) return;
    // Incoming clip fades in over its transition; the outgoing one stays opaque underneath.
    const opacity = inT && t < starts[i] + inT / 2 ? (t - from) / inT : 1;
    view(i, opacity);
  });
  clips.sort((a, b) => a.index - b.index);

  const captions = plan.captions.flatMap((c, i) => (t >= c.start && t < c.end ? [i] : []));
  const graphics = plan.graphics.filter((g) => t >= g.start && t < g.start + g.duration).map((g) => ({ id: g.id, local: t - g.start }));
  const vo = voiceoverStarts(plan);
  const voiceovers = Object.entries(voiceoverDurations)
    .map(([scene, d]) => ({ scene: Number(scene), start: vo[Number(scene)], d }))
    .filter((v) => v.start !== undefined && t >= v.start && t < v.start + v.d)
    .map((v) => ({ scene: v.scene, local: t - v.start }));
  return { t, duration, clips, captions, graphics, voiceovers };
}
