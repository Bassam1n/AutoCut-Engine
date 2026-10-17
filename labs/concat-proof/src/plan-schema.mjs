// The edit plan: one JSON document that fully describes the cut. Claude writes
// it, `execute.mjs` turns it into Hyperframes renders + Concat API edits, and a
// later "revise: make it punchier" turn rewrites it. Times are seconds on the
// output timeline unless a field says "source".
import { z } from "zod";

// Concat transition ids (concat-export/src/lib.rs); "cut" means none.
export const TRANSITIONS = ["cut", "cross-fade", "fade-black", "fade-white", "push", "zoom", "wipe-left", "wipe-right",
  "concat.whip-pan", "concat.blur-dissolve", "concat.light-leak-transition", "concat.zoom-blur-transition", "concat.slide"];

const MotionKey = z.object({
  at: z.number().describe("0..1, fraction of the clip's length on the timeline"),
  scale: z.number().describe("1 = frame filled; 1.15 = 15% zoom in"),
  offsetX: z.number().describe("fraction of frame width, + is right; keep within +-0.1"),
  offsetY: z.number().describe("fraction of frame height, + is down; keep within +-0.1"),
});

const Clip = z.object({
  scene: z.number().int().describe("scene index this footage comes from"),
  sourceIn: z.number().describe("seconds into the scene clip where this shot starts"),
  sourceOut: z.number().describe("seconds into the scene clip where this shot ends"),
  transitionIn: z.object({ type: z.enum(TRANSITIONS), duration: z.number() }).nullable()
    .describe("transition from the previous clip; null for a hard cut or for the first clip"),
  motion: z.object({ keys: z.array(MotionKey), ease: z.enum(["linear", "in", "out", "inOut"]) }).nullable()
    .describe("Ken Burns: two or more keys; null for a static shot"),
  volume: z.number().describe("ambient clip audio, 0..1"),
});

// No z.record anywhere: structured outputs turn a record into an object that
// allows no keys, so Claude could only ever return {}. Named things are lists.
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
  text: z.string().describe("at most ~7 words; a phrase the viewer can read in time"),
  style: z.string().describe("name of one of the captionStyles"),
  popIn: z.boolean().describe("short scale pop on entry"),
});

const TemplateProps = z.object({
  headline: z.string().nullable().describe("hookPill, endCard"),
  sub: z.string().nullable().describe("hookPill, endCard"),
  text: z.string().nullable().describe("callout"),
  cta: z.string().nullable().describe("endCard"),
  bg: z.string().nullable().describe("endCard background colour"),
  accent: z.string().nullable().describe("all templates: accent colour"),
}).describe("null for props the template doesn't use");
export const TEMPLATE_REQUIRED = { hookPill: ["headline"], callout: ["text"], endCard: ["headline", "cta"] };

const Graphic = z.object({
  id: z.string().describe("short slug, e.g. hook, endcard"),
  role: z.enum(["hook", "endCard", "callout"]),
  start: z.number(),
  duration: z.number(),
  layout: z.enum(["overlay", "fullFrame"]).describe("overlay = transparent over footage; fullFrame = opaque card, footage hidden"),
  template: z.object({ name: z.enum(["hookPill", "endCard", "callout"]), props: TemplateProps }).nullable()
    .describe("template mode: a built-in template and its text props; null in direct mode"),
  code: z.object({
    css: z.string().describe("CSS for elements inside #root (1080x1920 px)"),
    html: z.string().describe("markup placed inside #root"),
    js: z.string().describe("body of function(tl, root){...}: add GSAP tweens to the paused timeline tl; times in seconds from the graphic start"),
  }).nullable().describe("direct mode: the motion graphic, written by you; null in template mode"),
});

export const EditPlan = z.object({
  summary: z.string().describe("one or two sentences: the edit's idea"),
  clips: z.array(Clip).describe("in timeline order, laid end to end on the main track"),
  captionStyles: z.array(TextStyle),
  captions: z.array(Caption).describe("non-overlapping, in time order"),
  graphics: z.array(Graphic),
  endCardHold: z.number().describe("seconds the timeline runs past the last clip for a full-frame end card; 0 if none"),
});

export const Review = z.object({
  verdict: z.enum(["ship", "fix"]),
  issues: z.array(z.object({ at: z.number().nullable(), problem: z.string(), fix: z.string() })),
  revisedPlan: EditPlan.describe("the full plan with the fixes applied (the same plan if verdict is ship)"),
});

/** Checks Claude can't be held to by the JSON schema; returns problems as strings. */
export function lintPlan(plan, ad, clipDurations, mode) {
  const p = [];
  let t = 0;
  plan.clips.forEach((c, i) => {
    const dur = clipDurations[c.scene];
    if (dur == null) p.push(`clips[${i}]: no scene ${c.scene}`);
    if (c.sourceIn < 0 || c.sourceOut > dur + 1e-3 || c.sourceOut - c.sourceIn < 0.5) p.push(`clips[${i}]: source ${c.sourceIn}-${c.sourceOut} outside 0-${dur} or under 0.5 s`);
    if (c.transitionIn && c.transitionIn.type !== "cut") {
      if (i === 0) p.push(`clips[0]: first clip cannot have a transition`);
      const half = c.transitionIn.duration / 2;
      const prev = plan.clips[i - 1];
      if (prev && (c.sourceIn < half || prev.sourceOut + half > clipDurations[prev.scene] + 1e-3))
        p.push(`clips[${i}]: ${c.transitionIn.type} of ${c.transitionIn.duration}s needs ${half}s of unused footage before sourceIn and after the previous clip's sourceOut`);
    }
    for (const k of c.motion?.keys ?? []) {
      if (k.scale < 0.999) p.push(`clips[${i}]: scale ${k.scale} below 1 shows black bars`);
      else if (Math.abs(k.offsetX) > (k.scale - 1) / 2 + 1e-3 || Math.abs(k.offsetY) > (k.scale - 1) / 2 + 1e-3)
        p.push(`clips[${i}]: offset larger than (scale-1)/2 exposes the frame edge`);
    }
    t += c.sourceOut - c.sourceIn;
  });
  const end = t + plan.endCardHold;
  if (Math.abs(end - ad.targetLengthSeconds) > 3) p.push(`total length ${end.toFixed(1)}s is more than 3s from the ${ad.targetLengthSeconds}s target`);
  let last = -1;
  for (const [i, c] of plan.captions.entries()) {
    if (!plan.captionStyles.some((st) => st.name === c.style)) p.push(`captions[${i}]: unknown style ${c.style}`);
    if (c.start < last - 1e-3) p.push(`captions[${i}]: overlaps the previous caption`);
    if (c.end - c.start < 0.4) p.push(`captions[${i}]: shorter than 0.4s`);
    last = c.end;
  }
  for (const g of plan.graphics) {
    if (mode === "template" && !g.template) p.push(`graphic ${g.id}: template mode needs template`);
    for (const k of TEMPLATE_REQUIRED[g.template?.name] ?? []) if (!g.template.props?.[k]) p.push(`graphic ${g.id}: ${g.template.name} needs props.${k}`);
    if (mode === "direct" && !g.code) p.push(`graphic ${g.id}: direct mode needs code`);
    if (g.start + g.duration > end + 0.05) p.push(`graphic ${g.id}: runs past the end (${end.toFixed(2)}s)`);
  }
  return p;
}
