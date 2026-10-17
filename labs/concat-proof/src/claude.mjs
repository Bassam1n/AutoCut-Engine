// Claude as the editor: plan, review a rendered preview, revise on request.
// Every call uses structured outputs (zod schema), and its usage is logged
// so the run can report tokens and cost per edit.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { FONT_NOTE } from "./graphics.mjs";
import { EditPlan, Review, TRANSITIONS } from "./plan-schema.mjs";

export const MODEL = "claude-opus-5-5";
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }; // $ per 1M tokens, Opus 5.5

// Explicit base URL: a Claude Code container sets ANTHROPIC_BASE_URL for its
// own traffic, which the SDK would otherwise pick up.
let client;
const api = () => (client ??= new Anthropic({ baseURL: process.env.PROOF_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" }));
export const usageLog = [];

function cost(u) {
  return ((u.input_tokens ?? 0) * PRICE.input + (u.output_tokens ?? 0) * PRICE.output +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / 1e6;
}

const SYSTEM = `You are the video editor for AutoCut, which makes short vertical (1080x1920, 30 fps) social ads.
You receive an ad's script, its scenes with the generated footage for each (and sampled frames), and you decide the whole edit.
Your edit is executed exactly as written by the Concat video engine and Hyperframes (HTML + GSAP motion graphics), so every number matters.

How the edit is built:
- clips play end to end on the main track in the order you give. sourceIn/sourceOut are seconds inside that scene's clip.
- transitionIn blends from the previous clip, centred on the cut, using footage beyond the cut on both sides: the incoming clip needs duration/2 seconds before its sourceIn and the previous clip needs duration/2 seconds after its sourceOut. Available: ${TRANSITIONS.join(", ")}. Hard cuts are the default for punchy ads; use transitions sparingly.
- motion is a Ken Burns move: keyframes of scale (>= 1; 1 fills the frame) and offsetX/offsetY (fractions of the frame; keep |offset| <= (scale-1)/2 so no edge shows). Use one or two, subtle (scale 1.0 -> 1.08..1.15).
- captions are on-screen text shown on top of footage, timed in seconds on the output timeline. This ad has NO voiceover: the captions carry the script. Show short phrases (<= 7 words) at a readable pace (about 2.5-3.5 words per second), in sync with the scene they belong to. You may tighten wording but keep the meaning and the product claims exactly.
- captionStyles defines named text styles; fontSize is a fraction of frame height; offsetY is from frame centre (+ is down). Keep captions in the safe area: not in the top 12% or the bottom 18% of the frame, and clear of faces and of graphics.
- graphics are motion-graphic layers rendered by Hyperframes. layout "overlay" is transparent over footage; "fullFrame" is an opaque card (for an end card after the footage, use endCardHold seconds so the timeline runs past the last clip). Include a hook graphic in the first ~2.5 s and an end card with a call to action.
- The total length (sum of clip lengths + endCardHold) must be within 3 s of the target length.`;

const MODE_TEMPLATE = `MODE: template. Every graphic uses a built-in template (code: null):
- hookPill {headline, sub, accent}: a bold rounded pill headline in the upper third with a smaller line under it. Overlay.
- callout {text, accent}: a short tilted sticker phrase, upper middle. Overlay.
- endCard {headline, sub, cta, bg, accent}: full-frame card with headline, subline and a CTA button. fullFrame.
Colours are CSS strings.`;

const MODE_DIRECT = `MODE: direct. You write every graphic yourself (template: null) as {css, html, js}:
- Your html goes inside <div id="root"> (1080x1920 px, position: relative). Position elements absolutely in px.
- js is the body of function(tl, root) { ... }: add GSAP 3 tweens to the paused timeline tl with absolute positions in seconds (e.g. tl.fromTo("#h", {...}, {...}, 0.2)). Everything must be driven by tl (no setTimeout, no CSS animations, no requestAnimationFrame, no randomness, no network). The timeline is cut at the graphic's duration.
- Overlay graphics keep a transparent background (only paint the elements). fullFrame graphics must paint the whole frame.
- ${FONT_NOTE}
- Design for a phone screen: big, bold, high contrast, legible in under a second. Animate in quickly (0.2-0.4 s) and out before the end.`;

function image(path) {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(path).toString("base64") } };
}

async function call({ label, schema, content, effort = "high" }) {
  const t0 = performance.now();
  const res = await api().messages.parse({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort, format: zodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  const entry = { label, ms: Math.round(performance.now() - t0), stop: res.stop_reason, usage: res.usage, usd: cost(res.usage) };
  usageLog.push(entry);
  if (res.stop_reason === "refusal") throw new Error(`${label}: Claude declined (${JSON.stringify(res.stop_details)})`);
  if (res.stop_reason === "max_tokens") throw new Error(`${label}: hit max_tokens`);
  if (!res.parsed_output) throw new Error(`${label}: output did not parse`);
  return res.parsed_output;
}

function adBlock(ad, clipDurations, frames) {
  const parts = [{ type: "text", text: `AD\n${JSON.stringify({ ...ad, scenes: ad.scenes.map((s) => ({ ...s, clipDuration: clipDurations[s.index] })) }, null, 1)}` }];
  for (const s of ad.scenes) {
    parts.push({ type: "text", text: `Scene ${s.index} frames at ${frames[s.index].map((f) => f.t.toFixed(1)).join(", ")} s of its clip:` });
    for (const f of frames[s.index]) parts.push(image(f.file));
  }
  return parts;
}

export async function planEdit({ ad, clipDurations, frames, mode }) {
  return call({ label: "plan", schema: EditPlan, content: [
    { type: "text", text: mode === "direct" ? MODE_DIRECT : MODE_TEMPLATE },
    ...adBlock(ad, clipDurations, frames),
    { type: "text", text: "Plan the edit." },
  ] });
}

/** Asks for fixes to lint problems the schema can't express. */
export async function fixPlan({ ad, clipDurations, plan, problems, mode }) {
  return call({ label: "fix", schema: EditPlan, effort: "medium", content: [
    { type: "text", text: mode === "direct" ? MODE_DIRECT : MODE_TEMPLATE },
    { type: "text", text: `AD\n${JSON.stringify(ad)}\nClip durations: ${JSON.stringify(clipDurations)}` },
    { type: "text", text: `Your plan:\n${JSON.stringify(plan)}\n\nIt has these problems:\n- ${problems.join("\n- ")}\n\nReturn the corrected full plan; change nothing else.` },
  ] });
}

export async function reviewPreview({ ad, clipDurations, plan, previewFrames, mode, extra = "" }) {
  const content = [
    { type: "text", text: mode === "direct" ? MODE_DIRECT : MODE_TEMPLATE },
    { type: "text", text: `AD\n${JSON.stringify(ad)}\nClip durations: ${JSON.stringify(clipDurations)}` },
    { type: "text", text: `The plan that was rendered:\n${JSON.stringify(plan)}` },
    { type: "text", text: "Frames sampled from the rendered low-res preview (time on the output timeline):" },
  ];
  for (const f of previewFrames) content.push({ type: "text", text: `t=${f.t.toFixed(2)}s` }, image(f.file));
  content.push({ type: "text", text: `Review the cut as the editor about to hand it to a client. Check legibility and placement of captions and graphics, collisions with faces or with each other, pacing, caption sync with the scenes, black frames or edges, and whether the hook and the end card work. ${extra}
Return verdict "ship" or "fix", the issues you found, and revisedPlan (the full plan with your fixes; identical if nothing needs fixing).` });
  return call({ label: "review", schema: Review, content });
}

/** A later chat turn: "revise: make it punchier". */
export async function revisePlan({ ad, clipDurations, plan, instruction, mode }) {
  return call({ label: "revise", schema: EditPlan, content: [
    { type: "text", text: mode === "direct" ? MODE_DIRECT : MODE_TEMPLATE },
    { type: "text", text: `AD\n${JSON.stringify(ad)}\nClip durations: ${JSON.stringify(clipDurations)}` },
    { type: "text", text: `Current plan:\n${JSON.stringify(plan)}\n\nThe client asks: "${instruction}"\nReturn the full revised plan.` },
  ] });
}
