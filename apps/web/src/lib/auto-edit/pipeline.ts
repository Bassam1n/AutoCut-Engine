import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicKey } from "@/lib/claude/core";
import { LlmCallError } from "@/lib/claude/types";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { AdNotReadyError, frameAt, loadAd, type LoadedAd } from "./context";
import { Director, type ClaudeCallRecord, type FrameImage } from "./director";
import { EngineProcess } from "./engine-client";
import { FINAL_EXPORT, PREVIEW_EXPORT, buildProject, exportProject, type ExportSettings } from "./executor";
import { hyperframesRenderer, renderPlanGraphics, type GraphicOutcome } from "./graphics-render";
import { lintPlan, previewSampleTimes } from "./lint";
import type { AutoEditErrorCode, AutoEditStatus } from "./messages";
import { EditPlan, type AutoEditMode, type Review, type ReviewIssue } from "./plan-schema";
import { toolchainPaths, type ToolchainPaths } from "./toolchain";

/**
 * One Auto-edit run, as steps:
 *   plan (or revise) -> lint -> graphics + preview -> review -> fix -> final
 * Each step's result is written to the auto_edit_runs row before the
 * next starts. A retry (Trigger.dev re-runs the task after a crash or a
 * failed render) reads the row and skips every Claude step that already
 * has a result, so a failed render never pays Claude twice.
 * Revisions skip the preview and review: the proof's single review
 * round belongs to the first cut, and its findings travel with every
 * revision instead.
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

const EXPORT_TIMEOUT_MS = { preview: 6 * 60_000, final: 12 * 60_000 };
const MAX_LINT_ROUNDS = 2;

export type PipelineOptions = {
  supabase: SupabaseClient;
  runId: string;
  workRoot: string;
  machine?: string;
  paths?: ToolchainPaths;
  log?: (m: string, extra?: Record<string, unknown>) => void;
};

export async function runAutoEdit(o: PipelineOptions): Promise<{ status: AutoEditStatus; finalAssetId?: string }> {
  const { supabase, runId } = o;
  const log = o.log ?? (() => {});
  const paths = o.paths ?? toolchainPaths();

  let run = await readRun(supabase, runId);
  if (["succeeded", "failed", "cancelled"].includes(run.status)) {
    log("run already finished", { status: run.status });
    return { status: run.status };
  }

  const update = async (patch: Partial<RunRow> & Record<string, unknown>) => {
    const { data, error } = await supabase.from("auto_edit_runs").update(patch).eq("id", runId).select("*").single();
    if (error) throw new Error(`could not update the run: ${error.message}`);
    run = data as RunRow;
  };
  const timed = async <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const r = await f();
    await update({ timings: { ...run.timings, [key]: Math.round(performance.now() - t0) } });
    return r;
  };

  await update({ status: run.plan ? run.status : "planning", started_at: run.started_at ?? new Date().toISOString(), machine: o.machine ?? null, error: null, error_code: null });

  // Refuse before spending anything: suspended, unpaid, paused, storage
  // full, or an archived brand.
  const claim =
    (await supabase.rpc("claim_paid_media_job", { target_org_id: run.org_id })).error ??
    (await supabase.rpc("assert_brand_active", { target_org_id: run.org_id, target_brand_id: run.brand_id })).error;
  if (claim) throw new AutoEditFailure("SPEND_LIMIT", spendLimitMessage(claim.message));

  const workDir = join(o.workRoot, runId);
  await mkdir(workDir, { recursive: true });
  try {
    const ad = await timed("loadMs", () => loadAd(supabase, run.ad_id, paths, workDir)).catch((e) => {
      if (e instanceof AdNotReadyError) throw new AutoEditFailure("AD_NOT_READY", e.message);
      throw e;
    });

    const director = new Director({
      supabase, orgId: run.org_id, brandId: run.brand_id, adId: run.ad_id, mode: run.mode,
      apiKey: await getAnthropicKey(supabase, run.org_id, run.brand_id),
      context: ad.context,
      onCall: async (rec) => {
        log(`claude ${rec.label}: ${rec.ms} ms, $${rec.usd.toFixed(4)}`, rec as unknown as Record<string, unknown>);
        await update({ claude_calls: [...run.claude_calls, rec], claude_usd: +(Number(run.claude_usd) + rec.usd).toFixed(6) });
      },
    });

    // Lint problems go back to Claude, at most twice.
    const valid = async (plan: EditPlan, label: string): Promise<EditPlan> => {
      plan = EditPlan.parse(plan);
      let problems = lintPlan(plan, ad.lint, run.mode);
      for (let round = 0; problems.length && round < MAX_LINT_ROUNDS; round++) {
        log(`${label}: ${problems.length} lint problems`, { problems });
        plan = EditPlan.parse(await director.fix(plan, problems, "lint_fix"));
        problems = lintPlan(plan, ad.lint, run.mode);
      }
      if (problems.length) throw new AutoEditFailure("VALIDATION", `plan still invalid: ${problems.join(" | ")}`);
      return plan;
    };

    // 1. Plan, or revise the parent's plan.
    if (!run.plan) {
      if (run.kind === "revision") {
        const parent = await readRun(supabase, run.parent_run_id!);
        if (!parent.plan) throw new AutoEditFailure("INTERNAL", "the cut being revised has no plan");
        const revised = await timed("claudePlanMs", () => director.revise(parent.plan!, run.instruction ?? "", run.findings ?? []));
        const plan = await valid(revised, "revise");
        await update({ initial_plan: revised, plan, status: "rendering_final" });
      } else {
        const first = await timed("claudePlanMs", () => director.plan());
        const plan = await valid(first, "plan");
        await update({ initial_plan: first, plan, status: "rendering_preview" });
      }
    }

    const parallel = totalmem() >= 7e9 ? 2 : 1;
    const renderOne = hyperframesRenderer(paths, workDir);
    const render = async (label: "preview" | "final", settings: ExportSettings) => {
      const outcomes = await timed(`${label}GraphicsMs`, () => renderPlanGraphics(run.plan!, renderOne, { parallel, log }));
      await update({ graphics: outcomes.map((g) => ({ id: g.id, source: g.source, ms: g.ms, cached: g.cached, fallback: g.fallback ?? null })) });
      return timed(`${label}RenderMs`, () => renderVideo(ad, run.plan!, outcomes, paths, workDir, label, settings, log));
    };

    // 2. Preview, review and one round of fixes (first cuts only).
    if (run.kind === "edit" && !run.review) {
      await update({ status: "rendering_preview" });
      const preview = await render("preview", PREVIEW_EXPORT);
      const previewAssetId = await saveVideoAsset(supabase, run, preview, "preview");
      await update({ preview_asset_id: previewAssetId, status: "reviewing" });

      const frames: FrameImage[] = [];
      await mkdir(join(workDir, "preview-frames"), { recursive: true });
      for (const [i, t] of previewSampleTimes(run.plan!).entries()) {
        frames.push({ label: `t=${t.toFixed(2)}s`, jpeg: await frameAt(paths, preview, t, join(workDir, "preview-frames", `p${i}.jpg`), 405) });
      }
      const review = await timed("claudeReviewMs", () => director.review(run.plan!, frames));
      log(`review: ${review.verdict}, ${review.issues.length} issues`, { issues: review.issues });
      await update({ review });
      if (review.verdict === "fix" && review.issues.length) {
        await update({ status: "fixing" });
        const problems = review.issues.map((i) => `${i.at == null ? "" : `at ${i.at}s: `}${i.problem} Fix: ${i.fix}`);
        const fixed = await timed("claudeFixMs", () => director.fix(run.plan!, problems, "review_fix"));
        const plan = await valid(fixed, "review_fix");
        await update({ plan, findings: [...(run.findings ?? []), ...review.issues] });
      }
      await update({ status: "rendering_final" });
    }

    // 3. Final render.
    if (run.status !== "rendering_final") await update({ status: "rendering_final" });
    const final = await render("final", FINAL_EXPORT);
    const finalAssetId = await saveVideoAsset(supabase, run, final, "final");
    await update({ final_asset_id: finalAssetId, status: "succeeded", finished_at: new Date().toISOString() });
    return { status: "succeeded", finalAssetId };
  } catch (e) {
    throw classify(e);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderVideo(
  ad: LoadedAd, plan: EditPlan, graphics: GraphicOutcome[], paths: ToolchainPaths, workDir: string,
  label: "preview" | "final", settings: ExportSettings, log: (m: string) => void
): Promise<string> {
  const rpc = new EngineProcess({ bin: paths.concatBin, env: paths.concatEnv, cwd: workDir });
  try {
    const location = join(workDir, "projects");
    await rm(join(location, label), { recursive: true, force: true });
    await mkdir(location, { recursive: true });
    const projectPath = await buildProject(rpc, {
      plan, sceneFiles: ad.sceneFiles, voiceoverFiles: ad.voiceoverFiles,
      graphicFiles: Object.fromEntries(graphics.map((g) => [g.id, g.file])),
      fontPath: paths.interFont, location, name: label, log,
    });
    const out = join(workDir, `${label}.mp4`);
    await exportProject(rpc, projectPath, out, settings, { timeoutMs: EXPORT_TIMEOUT_MS[label], onProgress: (pct) => log(`${label} export ${pct}%`) });
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

/** Uploads a rendered video to the ad's folder in the renders bucket and records it as an asset. */
async function saveVideoAsset(supabase: SupabaseClient, run: RunRow, file: string, role: "preview" | "final"): Promise<string> {
  const storagePath = `${run.org_id}/renders/${run.ad_id}/auto-edit/${run.id}/${role}.mp4`;
  const bytes = await readFile(file);
  const { error: upErr } = await supabase.storage.from("renders").upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  const { data: last } = await supabase
    .from("assets").select("version").eq("ad_id", run.ad_id).eq("kind", "final").is("scene_id", null)
    .order("version", { ascending: false }).limit(1);
  const { data, error } = await supabase
    .from("assets")
    .insert({
      org_id: run.org_id,
      // Ad assets carry ad_id only (assets_ad_or_brand_check).
      ad_id: run.ad_id,
      scene_id: null,
      kind: "final",
      version: (last?.[0]?.version ?? 0) + 1,
      storage_path: storagePath,
      source: `auto-edit:${run.mode}`,
      // A preview is a working file: archived from the start, so the
      // archive purge clears it in time and nothing lists it as a cut.
      archived: role === "preview",
      archived_at: role === "preview" ? new Date().toISOString() : null,
      meta: { autoEdit: { runId: run.id, role, mode: run.mode, bytes: bytes.length } },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not record the ${role} video: ${error?.message}`);
  return data.id as string;
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
