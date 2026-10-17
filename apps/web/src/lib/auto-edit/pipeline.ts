import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicKey } from "@/lib/claude/core";
import { LlmCallError } from "@/lib/claude/types";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { AdNotReadyError, loadAd, type LoadedAd } from "./context";
import { Director, type ClaudeCallRecord, type FrameImage } from "./director";
import { EngineProcess } from "./engine-client";
import { buildProject, exportProject, type ExportSettings } from "./executor";
import { graphicCachePrefix, hyperframesRenderer, renderPlanGraphics, storageGraphicCache, type GraphicOutcome } from "./graphics-render";
import { lintPlan, previewSampleTimes } from "./lint";
import type { AutoEditErrorCode, AutoEditStatus } from "./messages";
import { EditPlan, type AutoEditMode, type Review, type ReviewIssue } from "./plan-schema";
import { toolchainPaths, type ToolchainPaths } from "./toolchain";

const run = promisify(execFile);

/**
 * One Auto-edit run, as steps:
 *   plan (or revise the timeline) -> lint -> review frames -> review -> fix -> timeline
 * The result goes onto the ad's timeline (ad_timelines), where the editor
 * previews it live in the browser and edits it; nothing is rendered to
 * MP4 here ("Render MP4" is its own job, render-pipeline.ts).
 *
 * Claude reviews stills of the true composite: the engine renders each
 * sampled instant with preview.frame (graphics included), which takes a
 * second or two per frame instead of a preview video export. The browser
 * can't capture the sandboxed graphics iframes or a closed tab, so the
 * review is done here.
 *
 * Each step's result is written to the run before the next starts; a
 * retry skips every Claude step that already has a result, so a failed
 * render never pays Claude twice. Revisions skip the review: their
 * findings travel with the timeline instead.
 */

export type RunRow = {
  id: string;
  org_id: string;
  brand_id: string;
  ad_id: string;
  parent_run_id: string | null;
  kind: "edit" | "revision";
  mode: AutoEditMode;
  status: AutoEditStatus;
  instruction: string | null;
  initial_plan: EditPlan | null;
  plan: EditPlan | null;
  base_plan: EditPlan | null;
  review: Review | null;
  findings: ReviewIssue[];
  graphics: unknown[];
  preview_asset_id: string | null;
  final_asset_id: string | null;
  claude_usd: number;
  claude_calls: ClaudeCallRecord[];
  timings: Record<string, number>;
  started_at: string | null;
};

export class AutoEditFailure extends Error {
  constructor(readonly code: AutoEditErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = "AutoEditFailure";
  }
}

const MAX_LINT_ROUNDS = 2;
const REVIEW_FRAME = { width: 405, height: 720 };

export type PipelineOptions = {
  supabase: SupabaseClient;
  runId: string;
  workRoot: string;
  machine?: string;
  paths?: ToolchainPaths;
  log?: (m: string, extra?: Record<string, unknown>) => void;
};

export async function runAutoEdit(o: PipelineOptions): Promise<{ status: AutoEditStatus }> {
  const { supabase, runId } = o;
  const log = o.log ?? (() => {});
  const paths = o.paths ?? toolchainPaths();

  let row = await readRun(supabase, runId);
  if (["succeeded", "failed", "cancelled"].includes(row.status)) {
    log("run already finished", { status: row.status });
    return { status: row.status };
  }

  const update = async (patch: Partial<RunRow> & Record<string, unknown>) => {
    const { data, error } = await supabase.from("auto_edit_runs").update(patch).eq("id", runId).select("*").single();
    if (error) throw new Error(`could not update the run: ${error.message}`);
    row = data as RunRow;
  };
  const timed = async <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const r = await f();
    await update({ timings: { ...row.timings, [key]: Math.round(performance.now() - t0) } });
    return r;
  };

  await update({ status: row.plan ? row.status : "planning", started_at: row.started_at ?? new Date().toISOString(), machine: o.machine ?? null, error: null, error_code: null });
  await claim(supabase, row.org_id, row.brand_id);

  const workDir = join(o.workRoot, runId);
  await mkdir(workDir, { recursive: true });
  try {
    const ad = await timed("loadMs", () => loadAdOrFail(supabase, row.ad_id, paths, workDir));

    const director = new Director({
      supabase, orgId: row.org_id, brandId: row.brand_id, adId: row.ad_id, mode: row.mode,
      apiKey: await getAnthropicKey(supabase, row.org_id, row.brand_id),
      context: ad.context,
      onCall: async (rec) => {
        log(`claude ${rec.label}: ${rec.ms} ms, $${rec.usd.toFixed(4)}`, rec as unknown as Record<string, unknown>);
        await update({ claude_calls: [...row.claude_calls, rec], claude_usd: +(Number(row.claude_usd) + rec.usd).toFixed(6) });
      },
    });

    // Lint problems go back to Claude, at most twice.
    const valid = async (plan: EditPlan, label: string): Promise<EditPlan> => {
      plan = EditPlan.parse(plan);
      let problems = lintPlan(plan, ad.lint, row.mode);
      for (let round = 0; problems.length && round < MAX_LINT_ROUNDS; round++) {
        log(`${label}: ${problems.length} lint problems`, { problems });
        plan = EditPlan.parse(await director.fix(plan, problems, "lint_fix"));
        problems = lintPlan(plan, ad.lint, row.mode);
      }
      if (problems.length) throw new AutoEditFailure("VALIDATION", `plan still invalid: ${problems.join(" | ")}`);
      return plan;
    };

    // 1. Plan, or revise the timeline as it stood when the editor asked.
    const revising = Boolean(row.instruction);
    if (!row.plan) {
      if (revising) {
        const base = row.base_plan ?? (row.parent_run_id ? (await readRun(supabase, row.parent_run_id)).plan : null);
        if (!base) throw new AutoEditFailure("INTERNAL", "there is no timeline to revise");
        const revised = await timed("claudePlanMs", () => director.revise(EditPlan.parse(base), row.instruction ?? "", row.findings ?? []));
        const plan = await valid(revised, "revise");
        await update({ initial_plan: revised, plan });
      } else {
        const first = await timed("claudePlanMs", () => director.plan());
        const plan = await valid(first, "plan");
        await update({ initial_plan: first, plan, status: "rendering_preview" });
      }
    }

    // 2. Review stills of the real composite, and one round of fixes (first cuts only).
    if (!revising && !row.review) {
      await update({ status: "rendering_preview" });
      const outcomes = await timed("reviewGraphicsMs", () =>
        renderPlanGraphics(row.plan!, hyperframesRenderer(paths, workDir, { cache: storageGraphicCache(supabase, graphicCachePrefix(row.org_id, row.ad_id)), log }), { parallel: graphicsParallelism(), log })
      );
      await update({ graphics: graphicsSummary(outcomes) });
      const frames = await timed("reviewFramesMs", () => reviewFrames(ad, row.plan!, outcomes, paths, workDir, log));
      await update({ status: "reviewing" });
      const review = await timed("claudeReviewMs", () => director.review(row.plan!, frames));
      log(`review: ${review.verdict}, ${review.issues.length} issues`, { issues: review.issues });
      await update({ review });
      if (review.verdict === "fix" && review.issues.length) {
        await update({ status: "fixing" });
        const problems = review.issues.map((i) => `${i.at == null ? "" : `at ${i.at}s: `}${i.problem} Fix: ${i.fix}`);
        const fixed = await timed("claudeFixMs", () => director.fix(row.plan!, problems, "review_fix"));
        const plan = await valid(fixed, "review_fix");
        await update({ plan, findings: [...(row.findings ?? []), ...review.issues] });
      }
    }

    // 3. Onto the timeline.
    await saveToTimeline(supabase, row, ad);
    await update({ status: "succeeded", finished_at: new Date().toISOString() });
    return { status: "succeeded" };
  } catch (e) {
    throw classify(e);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Builds the project once and renders each sampled instant as a still. */
export async function reviewFrames(ad: LoadedAd, plan: EditPlan, graphics: GraphicOutcome[], paths: ToolchainPaths, workDir: string, log: (m: string) => void): Promise<FrameImage[]> {
  const rpc = new EngineProcess({ bin: paths.concatBin, env: paths.concatEnv, cwd: workDir });
  try {
    const location = join(workDir, "projects");
    await rm(join(location, "review"), { recursive: true, force: true });
    await mkdir(location, { recursive: true });
    await mkdir(join(workDir, "review-frames"), { recursive: true });
    const path = await buildProject(rpc, {
      plan, sceneFiles: ad.sceneFiles, voiceoverFiles: ad.voiceoverFiles, footageSize: ad.sceneMeta,
      graphicFiles: Object.fromEntries(graphics.map((g) => [g.id, g.file])),
      fontPath: paths.interFont, location, name: "review", log,
    });
    const frames: FrameImage[] = [];
    for (const [i, t] of previewSampleTimes(plan).entries()) {
      const png = join(workDir, "review-frames", `f${i}.png`);
      const jpg = join(workDir, "review-frames", `f${i}.jpg`);
      await rpc.call("preview.frame", { path, time: t, output: png, ...REVIEW_FRAME });
      await run(paths.ffmpeg, ["-v", "error", "-y", "-i", png, "-q:v", "4", jpg], { env: paths.concatEnv });
      frames.push({ label: `t=${t.toFixed(2)}s`, jpeg: await readFile(jpg) });
    }
    return frames;
  } finally {
    await rpc.close().catch(() => {});
  }
}

/** Writes the run's plan onto the ad's timeline (creating it), bumping its version. */
async function saveToTimeline(supabase: SupabaseClient, r: RunRow, ad: LoadedAd): Promise<void> {
  const patch = {
    plan: r.plan,
    findings: r.findings ?? [],
    mode: r.mode,
    source_run_id: r.id,
    clip_durations: ad.lint.clipDurations,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current } = await supabase.from("ad_timelines").select("version").eq("ad_id", r.ad_id).maybeSingle();
    if (!current) {
      const { error } = await supabase.from("ad_timelines").insert({ ad_id: r.ad_id, org_id: r.org_id, brand_id: r.brand_id, ...patch });
      if (!error) return;
      continue; // created meanwhile: update instead
    }
    const { data, error } = await supabase
      .from("ad_timelines")
      .update({ ...patch, version: current.version + 1 })
      .eq("ad_id", r.ad_id)
      .eq("version", current.version)
      .select("version");
    if (!error && data?.length) return;
  }
  throw new Error("could not save the timeline");
}

// ---- Shared by the Auto-edit and render pipelines. ----

export async function claim(supabase: SupabaseClient, orgId: string, brandId: string): Promise<void> {
  // Refuse before spending anything: suspended, unpaid, paused, storage
  // full, or an archived brand.
  const claimError =
    (await supabase.rpc("claim_paid_media_job", { target_org_id: orgId })).error ??
    (await supabase.rpc("assert_brand_active", { target_org_id: orgId, target_brand_id: brandId })).error;
  if (claimError) throw new AutoEditFailure("SPEND_LIMIT", spendLimitMessage(claimError.message));
}

export async function loadAdOrFail(supabase: SupabaseClient, adId: string, paths: ToolchainPaths, workDir: string, opts?: { frames?: boolean }): Promise<LoadedAd> {
  return loadAd(supabase, adId, paths, workDir, opts).catch((e) => {
    if (e instanceof AdNotReadyError) throw new AutoEditFailure("AD_NOT_READY", e.message);
    throw e;
  });
}

/** Two graphics at once when the machine has the memory (Chromium peaks near 1.8 GB). */
export function graphicsParallelism(): number {
  return totalmem() >= 7e9 ? 2 : 1;
}

export function graphicsSummary(outcomes: GraphicOutcome[]) {
  return outcomes.map((g) => ({ id: g.id, source: g.source, ms: g.ms, cached: g.cached, fallback: g.fallback ?? null }));
}

/** Builds the project and exports one video file. */
export async function renderVideo(
  ad: LoadedAd, plan: EditPlan, graphics: GraphicOutcome[], paths: ToolchainPaths, workDir: string,
  label: string, settings: ExportSettings, timeoutMs: number, log: (m: string) => void
): Promise<string> {
  const rpc = new EngineProcess({ bin: paths.concatBin, env: paths.concatEnv, cwd: workDir });
  try {
    const location = join(workDir, "projects");
    await rm(join(location, label), { recursive: true, force: true });
    await mkdir(location, { recursive: true });
    const projectPath = await buildProject(rpc, {
      plan, sceneFiles: ad.sceneFiles, voiceoverFiles: ad.voiceoverFiles, footageSize: ad.sceneMeta,
      graphicFiles: Object.fromEntries(graphics.map((g) => [g.id, g.file])),
      fontPath: paths.interFont, location, name: label, log,
    });
    const out = join(workDir, `${label}.mp4`);
    await exportProject(rpc, projectPath, out, settings, { timeoutMs, onProgress: (pct) => log(`${label} export ${pct}%`) });
    if (!(await stat(out).then((s) => s.size > 0, () => false))) throw new Error(`${label} export produced no file`);
    return out;
  } finally {
    await rpc.close().catch(() => {});
  }
}

async function readRun(supabase: SupabaseClient, id: string): Promise<RunRow> {
  const { data, error } = await supabase.from("auto_edit_runs").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`Auto-edit run ${id} not found (${error?.message ?? "no row"})`);
  return data as RunRow;
}

/** Maps any failure to an AutoEditFailure; render and network errors are retryable. */
export function classify(e: unknown): AutoEditFailure {
  if (e instanceof AutoEditFailure) return e;
  if (e instanceof LlmCallError) {
    const retryable = e.code === "RATE_LIMIT" || e.code === "TIMEOUT" || e.code === "PROVIDER_ERROR";
    return new AutoEditFailure(e.code as AutoEditErrorCode, e.message, retryable);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new AutoEditFailure("RENDER_FAILED", msg, true);
}
