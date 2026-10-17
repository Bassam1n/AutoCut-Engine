// The whole loop for one ad:
//   context (script, scenes, sampled frames) -> Claude plans -> lint/fix ->
//   Hyperframes graphics + Concat edits -> low-res preview -> Claude reviews
//   sampled preview frames -> one round of fixes -> final 1080x1920 MP4.
//
//   node src/run.mjs --mode template|direct [--ad ad] [--work DIR] [--plan plan.json] [--no-review]
//   node src/run.mjs --mode direct --revise "make it punchier" --from DIR/final-plan.json
//
// --plan skips the planning call (executor test with a hand-written plan).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { env } from "./env.mjs";
import { executePlan } from "./execute.mjs";
import { EditPlan, lintPlan } from "./plan-schema.mjs";

const { values: a } = parseArgs({ options: {
  mode: { type: "string", default: "template" }, ad: { type: "string", default: "ad" },
  work: { type: "string" }, plan: { type: "string" }, "no-review": { type: "boolean" },
  revise: { type: "string" }, from: { type: "string" },
} });
const root = resolve(import.meta.dirname, "..");
const adDir = resolve(root, a.ad);
const media = process.env.AD_MEDIA_DIR ?? adDir;
const ad = JSON.parse(readFileSync(join(adDir, "ad.json"), "utf8"));
const work = resolve(a.work ?? `/home/user/work/edit-${a.mode}`);
mkdirSync(work, { recursive: true });
const log = (m) => console.log(`[${((performance.now()) / 1000).toFixed(1)}s] ${m}`);
const metrics = { mode: a.mode, started: new Date().toISOString(), steps: {} };
const time = async (k, f) => { const t = performance.now(); const r = await f(); metrics.steps[k] = Math.round(performance.now() - t); return r; };

const ff = (args) => execFileSync(env.ffmpeg, ["-v", "error", "-y", ...args], { env: env.concatEnv });
const probeDur = (f) => Number(execFileSync(env.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { env: env.concatEnv, encoding: "utf8" }));

function frameAt(video, t, out, w = 360) { ff(["-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${w}:-2`, "-q:v", "4", out]); return { t, file: out }; }

// Scene clip durations and sampled source frames (3 per scene).
const clipDurations = Object.fromEntries(ad.scenes.map((s) => [s.index, probeDur(join(media, s.clip))]));
const frames = {};
mkdirSync(join(work, "frames"), { recursive: true });
for (const s of ad.scenes) {
  const d = clipDurations[s.index];
  frames[s.index] = [0.15, 0.5, 0.85].map((f, i) => frameAt(join(media, s.clip), d * f, join(work, "frames", `s${s.index}-${i}.jpg`)));
}

const claude = a.plan ? null : await import("./claude.mjs");

async function validPlan(plan, label) {
  EditPlan.parse(plan);
  let problems = lintPlan(plan, ad, clipDurations, a.mode);
  for (let round = 0; problems.length && claude && round < 2; round++) {
    log(`${label}: ${problems.length} lint problems, asking Claude to fix: ${problems.join(" | ")}`);
    metrics[`${label}LintProblems${round}`] = problems;
    plan = await claude.fixPlan({ ad, clipDurations, plan, problems, mode: a.mode });
    problems = lintPlan(plan, ad, clipDurations, a.mode);
  }
  if (problems.length) throw new Error(`${label}: plan still invalid: ${problems.join(" | ")}`);
  return plan;
}

async function render(plan, label, w, h, crf, preset) {
  const r = await executePlan({ plan, ad, adDir: media, workDir: work, name: label, output: join(work, `${label}.mp4`), width: w, height: h, crf, preset, log });
  metrics[label] = r.timings;
  return r.output;
}

function previewFrames(video, plan) {
  // Mid-point of every clip, each caption, and the first second of each graphic.
  const ts = new Set();
  let t = 0;
  for (const c of plan.clips) { ts.add(+(t + (c.sourceOut - c.sourceIn) / 2).toFixed(2)); t += c.sourceOut - c.sourceIn; }
  for (const g of plan.graphics) ts.add(+(g.start + Math.min(1, g.duration / 2)).toFixed(2));
  for (const c of plan.captions) ts.add(+((c.start + c.end) / 2).toFixed(2));
  const sorted = [...ts].sort((x, y) => x - y);
  const step = Math.max(1, Math.ceil(sorted.length / 16)); // cap at 16 frames
  mkdirSync(join(work, "preview-frames"), { recursive: true });
  return sorted.filter((_, i) => i % step === 0).map((t2, i) => frameAt(video, t2, join(work, "preview-frames", `p${i}.jpg`), 405));
}

let plan;
if (a.revise) {
  plan = JSON.parse(readFileSync(a.from, "utf8"));
  plan = await time("revise", () => claude.revisePlan({ ad, clipDurations, plan, instruction: a.revise, mode: a.mode }));
  plan = await validPlan(plan, "revise");
  writeFileSync(join(work, "revised-plan.json"), JSON.stringify(plan, null, 2));
  await time("finalRender", () => render(plan, "revised", 1080, 1920, 20, "medium"));
} else {
  plan = a.plan ? JSON.parse(readFileSync(a.plan, "utf8")) : await time("plan", () => claude.planEdit({ ad, clipDurations, frames, mode: a.mode }));
  plan = await validPlan(plan, "plan");
  writeFileSync(join(work, "plan.json"), JSON.stringify(plan, null, 2));
  log(`plan: ${plan.clips.length} clips, ${plan.captions.length} captions, ${plan.graphics.length} graphics. ${plan.summary}`);

  const preview = await time("previewRender", () => render(plan, "preview", 540, 960, 30, "veryfast"));
  log(`preview: ${preview}`);

  if (claude && !a["no-review"]) {
    const pf = previewFrames(preview, plan);
    const review = await time("review", () => claude.reviewPreview({ ad, clipDurations, plan, previewFrames: pf, mode: a.mode }));
    metrics.review = { verdict: review.verdict, issues: review.issues, frames: pf.length };
    writeFileSync(join(work, "review.json"), JSON.stringify(review, null, 2));
    log(`review: ${review.verdict}, ${review.issues.length} issues`);
    for (const i of review.issues) log(`  - ${i.at ?? "-"}s ${i.problem} -> ${i.fix}`);
    if (review.verdict === "fix") plan = await validPlan(review.revisedPlan, "review");
  }
  writeFileSync(join(work, "final-plan.json"), JSON.stringify(plan, null, 2));
  await time("finalRender", () => render(plan, "final", 1080, 1920, 20, "medium"));
}

if (claude) {
  metrics.claude = claude.usageLog;
  metrics.claudeTotalUsd = +claude.usageLog.reduce((s, u) => s + u.usd, 0).toFixed(4);
  metrics.claudeTokens = claude.usageLog.reduce((s, u) => ({ input: s.input + (u.usage.input_tokens ?? 0), output: s.output + (u.usage.output_tokens ?? 0) }), { input: 0, output: 0 });
}
metrics.finished = new Date().toISOString();
writeFileSync(join(work, "metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
