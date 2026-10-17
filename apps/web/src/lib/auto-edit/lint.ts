import { captionRuleProblems } from "./captions";
import { checkGraphicCode } from "./graphics-sandbox";
import { transitionLabel } from "./transitions";
import { TEMPLATE_REQUIRED, TRANSITIONS, footageLabel, isUploadIndex, planLength, voiceoverStarts, type AutoEditMode, type EditPlan } from "./plan-schema";

/** What lint needs to know about the ad beyond the plan. */
export type LintContext = {
  targetLengthSeconds: number;
  /** Seconds of footage in each scene's clip, by scene index. */
  clipDurations: Record<number, number>;
  /** Seconds of each scene's separate voiceover, by scene index. */
  voiceoverDurations?: Record<number, number>;
};

export const LENGTH_TOLERANCE_SECONDS = 3;

/**
 * Checks the JSON schema can't express. lintPlan() is what Claude is held
 * to: renderProblems() (the plan must be renderable) plus the editorial
 * rules (target length, the caption rule, the mode's graphics, voiceover
 * spacing). Problems are worded for Claude, which gets them back to fix
 * (at most twice). Designed-mode graphic code that fails the sandbox
 * checks isn't a lint problem: it falls back to the graphic's template
 * (see graphics-sandbox.ts).
 *
 * Manual edits in the timeline editor and "Render MP4" are held to
 * renderProblems() only: an editor may make the ad longer, or split a
 * caption, on purpose.
 */
export function renderProblems(plan: EditPlan, ctx: Pick<LintContext, "clipDurations">): string[] {
  const p: string[] = [];
  const { clipDurations } = ctx;
  if (plan.clips.length === 0) p.push("clips: the edit has no footage");
  plan.clips.forEach((c, i) => {
    const dur = clipDurations[c.scene];
    if (dur == null) {
      p.push(isUploadIndex(c.scene) ? `clips[${i}]: uploaded clip ${c.scene} (${footageLabel(c.scene)}) is no longer in the ad's media` : `clips[${i}]: there is no scene ${c.scene}`);
      return;
    }
    if (c.sourceIn < 0 || c.sourceOut > dur + 1e-3 || c.sourceOut - c.sourceIn < 0.5) {
      p.push(`clips[${i}]: source ${c.sourceIn}-${c.sourceOut} is outside 0-${dur.toFixed(2)} or under 0.5 s`);
    }
    if (c.volume < 0 || c.volume > 1) p.push(`clips[${i}]: volume ${c.volume} is outside 0..1`);
    if (c.transitionIn && c.transitionIn.type !== "cut") {
      if (i === 0) p.push("clips[0]: the first clip cannot have a transition");
      const half = c.transitionIn.duration / 2;
      const prev = plan.clips[i - 1];
      if (prev && (c.sourceIn < half || prev.sourceOut + half > (clipDurations[prev.scene] ?? 0) + 1e-3)) {
        p.push(`clips[${i}]: ${c.transitionIn.type} of ${c.transitionIn.duration}s needs ${half}s of unused footage before sourceIn and after the previous clip's sourceOut`);
      }
    }
    if (c.motion && c.motion.keys.length < 2) p.push(`clips[${i}]: motion needs two or more keys`);
    for (const k of c.motion?.keys ?? []) {
      if (k.at < 0 || k.at > 1) p.push(`clips[${i}]: motion key at ${k.at} is outside 0..1`);
      if (k.scale < 0.999) p.push(`clips[${i}]: scale ${k.scale} below 1 shows black bars`);
      else if (Math.abs(k.offsetX) > (k.scale - 1) / 2 + 1e-3 || Math.abs(k.offsetY) > (k.scale - 1) / 2 + 1e-3) {
        p.push(`clips[${i}]: offset larger than (scale-1)/2 exposes the frame edge`);
      }
    }
  });

  const end = planLength(plan);
  if (plan.endCardHold < 0) p.push("endCardHold cannot be negative");

  let last = -1;
  plan.captions.forEach((c, i) => {
    if (!plan.captionStyles.some((st) => st.name === c.style)) p.push(`captions[${i}]: unknown style ${c.style}`);
    if (c.start < last - 1e-3) p.push(`captions[${i}]: overlaps the previous caption`);
    if (c.end - c.start < 0.4) p.push(`captions[${i}]: shorter than 0.4s`);
    if (c.end > end + 0.05) p.push(`captions[${i}]: runs past the end (${end.toFixed(2)}s)`);
    last = c.end;
  });

  const ids = new Set<string>();
  for (const g of plan.graphics) {
    if (ids.has(g.id)) p.push(`graphic ${g.id}: duplicate id`);
    ids.add(g.id);
    for (const k of TEMPLATE_REQUIRED[g.template.name]) {
      if (!g.template.props[k]) p.push(`graphic ${g.id}: ${g.template.name} needs props.${k}`);
    }
    if (g.duration < 0.5) p.push(`graphic ${g.id}: shorter than 0.5s`);
    if (g.start < 0 || g.start + g.duration > end + 0.05) p.push(`graphic ${g.id}: runs outside the timeline (0-${end.toFixed(2)}s)`);
  }
  return p;
}

export function lintPlan(plan: EditPlan, ctx: LintContext, mode: AutoEditMode): string[] {
  const p = renderProblems(plan, ctx);
  const end = planLength(plan);
  if (Math.abs(end - ctx.targetLengthSeconds) > LENGTH_TOLERANCE_SECONDS) {
    p.push(`total length ${end.toFixed(1)}s is more than ${LENGTH_TOLERANCE_SECONDS}s from the ${ctx.targetLengthSeconds}s target`);
  }
  // A separate voiceover runs from its scene's first clip; the next
  // scene's line must not start before it ends.
  const voStarts = voiceoverStarts(plan);
  const voiced = Object.entries(ctx.voiceoverDurations ?? {})
    .map(([scene, dur]) => ({ scene: Number(scene), start: voStarts[Number(scene)], dur }))
    .filter((v) => v.start !== undefined)
    .sort((a, b) => a.start - b.start);
  voiced.forEach((v, i) => {
    const endsAt = v.start + v.dur;
    const next = voiced[i + 1];
    if (next && endsAt > next.start + 0.05) {
      p.push(`scene ${v.scene}'s voiceover (${v.dur.toFixed(2)}s from ${v.start.toFixed(2)}s) runs into scene ${next.scene}'s, which starts at ${next.start.toFixed(2)}s; give scene ${v.scene} more time on screen`);
    }
    if (endsAt > end + 0.05) p.push(`scene ${v.scene}'s voiceover ends at ${endsAt.toFixed(2)}s, after the edit ends (${end.toFixed(2)}s)`);
  });

  p.push(...captionRuleProblems(plan.captions));
  for (const g of plan.graphics) {
    if (mode === "clean" && g.code) p.push(`graphic ${g.id}: clean mode uses templates only; set code to null`);
    if (mode === "designed" && !g.code) p.push(`graphic ${g.id}: designed mode needs code`);
  }
  return p;
}

/** Sandbox problems in designed-mode graphics, by graphic id. Not sent to Claude: these graphics fall back to their template. */
export function unsafeGraphics(plan: EditPlan): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of plan.graphics) {
    if (!g.code) continue;
    const problems = checkGraphicCode(g.code);
    if (problems.length) out[g.id] = problems;
  }
  return out;
}

/**
 * Preview timestamps Claude reviews: every clip's midpoint, each
 * caption's midpoint and the first second of each graphic, capped at
 * `max` frames spread evenly.
 */
export function previewSampleTimes(plan: EditPlan, max = 16): number[] {
  const ts = new Set<number>();
  let t = 0;
  for (const c of plan.clips) {
    const len = c.sourceOut - c.sourceIn;
    ts.add(+(t + len / 2).toFixed(2));
    t += len;
  }
  for (const g of plan.graphics) ts.add(+(g.start + Math.min(1, g.duration / 2)).toFixed(2));
  for (const c of plan.captions) ts.add(+((c.start + c.end) / 2).toFixed(2));
  const sorted = [...ts].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(sorted.length / max));
  return sorted.filter((_, i) => i % step === 0);
}

/**
 * A render problem in the editor's words: the checks are written for
 * Claude (clips[1], sourceIn), and the timeline shows them to people.
 */
export function problemForEditors(problem: string): string {
  return problem
    .replace(/^clips\[(\d+)\]:/, (_, i) => `Clip ${Number(i) + 1}:`)
    .replace(/^captions\[(\d+)\]:/, (_, i) => `Caption ${Number(i) + 1}:`)
    .replace(/^graphic (\S+):/, "Graphic $1:")
    .replace(/\b((?:concat\.)?[a-z]+(?:-[a-z]+)*) of ([\d.]+)s needs/, (m, id: string, d: string) => (TRANSITIONS.includes(id as never) ? `the ${transitionLabel(id)} (${d} s) needs` : m))
    .replace(/before sourceIn and after the previous clip's sourceOut/, "before this clip's start and after the previous clip's end; trim them in a little or shorten the transition")
    .replace(/\bsource ([\d.]+)-([\d.]+) is outside/, "the part used ($1-$2 s) is outside");
}
