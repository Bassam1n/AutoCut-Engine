import { z } from "zod";
import { TRANSITION_CATALOGUE, type TransitionId } from "./transitions";

/**
 * Auto-edit's edit plan: one JSON document that fully describes the cut.
 * Claude writes it (structured outputs), the worker turns it into
 * Hyperframes renders and render-engine edits, and a revision turn
 * ("make it punchier") rewrites it. Times are seconds on the output
 * timeline unless a field says "source".
 *
 * Two constraints from structured outputs shape this file (both found
 * the hard way in the labs proof):
 * - No z.record anywhere: it compiles to an object that allows no keys,
 *   so Claude could only ever return {}. Named things are lists.
 * - The compiled grammar has a size limit. Review returns verdict and
 *   issues only (a fix is a second call with EditPlan), and unused
 *   template props are "" rather than nullable.
 * schema-contract.test.ts sends each schema to the API to catch both.
 */

export const AUTO_EDIT_MODES = ["designed", "clean"] as const;
export type AutoEditMode = (typeof AUTO_EDIT_MODES)[number];

// Render-engine transition ids (see transitions.ts); "cut" means none.
export const TRANSITIONS = ["cut", ...TRANSITION_CATALOGUE.map((t) => t.id)] as ["cut", ...TransitionId[]];

const MotionKey = z.object({
  at: z.number().describe("0..1, fraction of the clip's length on the timeline"),
  scale: z.number().describe("1 = frame filled; 1.15 = 15% zoom in"),
  offsetX: z.number().describe("fraction of frame width, + is right; keep within +-0.1"),
  offsetY: z.number().describe("fraction of frame height, + is down; keep within +-0.1"),
});

const Clip = z.object({
  scene: z.number().int().describe("which footage: a scene index, or the index (1000 and up) of a clip the editor uploaded"),
  sourceIn: z.number().describe("seconds into the scene clip where this shot starts"),
  sourceOut: z.number().describe("seconds into the scene clip where this shot ends"),
  transitionIn: z.object({ type: z.enum(TRANSITIONS), duration: z.number() }).nullable()
    .describe("transition from the previous clip; null for a hard cut or for the first clip"),
  motion: z.object({ keys: z.array(MotionKey), ease: z.enum(["linear", "in", "out", "inOut"]) }).nullable()
    .describe("Ken Burns: two or more keys; null for a static shot"),
  volume: z.number().describe("the clip's own audio, 0..1"),
});

const TextStyle = z.object({
  name: z.string().describe("style name that captions refer to, e.g. main"),
  fontSize: z.number().describe("fraction of frame height, captions ~0.035-0.05"),
  fontWeight: z.number().int(),
  color: z.string().describe("#rrggbb"),
  background: z.string().describe("#rrggbbaa or empty string for none"),
  strokeWidth: z.number().describe("fraction of frame height, 0 = none"),
  strokeColor: z.string(),
  maxWidth: z.number().describe("fraction of frame width to wrap at, e.g. 0.86"),
  offsetY: z.number().describe("vertical position, fraction of frame height from centre, + is down; lower third ~0.28"),
});

const Caption = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string().describe("one whole sentence when it fits (at most 8 words); split a sentence only when it is longer"),
  style: z.string().describe("name of one of the captionStyles"),
  popIn: z.boolean().describe("short scale pop on entry"),
});

const TemplateProps = z.object({
  headline: z.string().describe("hookPill, endCard"),
  sub: z.string().describe("hookPill, endCard"),
  text: z.string().describe("callout"),
  cta: z.string().describe("endCard"),
  bg: z.string().describe("endCard background colour"),
  accent: z.string().describe("all templates: accent colour"),
}).describe("empty string for props the template doesn't use");

export const TEMPLATE_NAMES = ["hookPill", "endCard", "callout"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
export const TEMPLATE_REQUIRED: Record<TemplateName, (keyof z.infer<typeof TemplateProps>)[]> = {
  hookPill: ["headline"],
  callout: ["text"],
  endCard: ["headline", "cta"],
};

const Graphic = z.object({
  id: z.string().describe("short slug, e.g. hook, endcard"),
  role: z.enum(["hook", "endCard", "callout"]),
  start: z.number(),
  duration: z.number(),
  layout: z.enum(["overlay", "fullFrame"]).describe("overlay = transparent over footage; fullFrame = opaque card, footage hidden"),
  template: z.object({ name: z.enum(TEMPLATE_NAMES), props: TemplateProps })
    .describe("a built-in template and its text: the graphic itself in clean mode, the fallback in designed mode"),
  code: z.object({
    css: z.string().describe("CSS for elements inside #root (1080x1920 px)"),
    html: z.string().describe("markup placed inside #root"),
    js: z.string().describe("body of function(tl, root){...}: add GSAP tweens to the paused timeline tl; times in seconds from the graphic start"),
  }).nullable().describe("designed mode: the motion graphic, written by you; null in clean mode"),
});

export const EditPlan = z.object({
  summary: z.string().describe("one or two sentences: the edit's idea"),
  clips: z.array(Clip).describe("in timeline order, laid end to end on the main track"),
  captionStyles: z.array(TextStyle),
  captions: z.array(Caption).describe("non-overlapping, in time order"),
  graphics: z.array(Graphic),
  endCardHold: z.number().describe("seconds the timeline runs past the last clip for a full-frame end card; 0 if none"),
});
export type EditPlan = z.infer<typeof EditPlan>;
export type PlanClip = EditPlan["clips"][number];
export type PlanCaption = EditPlan["captions"][number];
export type PlanGraphic = EditPlan["graphics"][number];

export const Review = z.object({
  verdict: z.enum(["ship", "fix"]),
  issues: z.array(z.object({
    at: z.number().nullable(),
    problem: z.string(),
    fix: z.string().describe("the exact plan change: which field, from what to what"),
  })),
});
export type Review = z.infer<typeof Review>;
export type ReviewIssue = Review["issues"][number];

/** Seconds of output: the clips laid end to end plus the end card hold. */
export function planLength(plan: Pick<EditPlan, "clips" | "endCardHold">): number {
  return plan.clips.reduce((t, c) => t + (c.sourceOut - c.sourceIn), 0) + plan.endCardHold;
}

/** Timeline start of each plan clip. */
/** Clips the editor uploads are numbered from here; scenes are 0..n. */
export const UPLOAD_INDEX_BASE = 1000;

export function isUploadIndex(index: number): boolean {
  return index >= UPLOAD_INDEX_BASE;
}

/** "Scene 3" or "Upload 2": how people see a footage index. */
export function footageLabel(index: number): string {
  return isUploadIndex(index) ? `Upload ${index - UPLOAD_INDEX_BASE + 1}` : `Scene ${index + 1}`;
}

/** "S3" or "U2", for the timeline's clip blocks. */
export function footageShortLabel(index: number): string {
  return isUploadIndex(index) ? `U${index - UPLOAD_INDEX_BASE + 1}` : `S${index + 1}`;
}

export function clipStarts(plan: Pick<EditPlan, "clips">): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of plan.clips) {
    starts.push(t);
    t += c.sourceOut - c.sourceIn;
  }
  return starts;
}

/** Where each scene's separate voiceover starts: the start of the scene's first clip in the cut. */
export function voiceoverStarts(plan: Pick<EditPlan, "clips">): Record<number, number> {
  const starts = clipStarts(plan);
  const out: Record<number, number> = {};
  plan.clips.forEach((c, i) => {
    if (out[c.scene] === undefined) out[c.scene] = starts[i];
  });
  return out;
}
