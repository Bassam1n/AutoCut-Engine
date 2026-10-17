import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoadedAd } from "./context";
import { EngineProcess } from "./engine-client";
import { FINAL_EXPORT, buildProject } from "./executor";
import { CONCAT_PATH_SCRIPTS, exportText, type ExportFormat } from "./exports/bundle";
import type { ExportMedia } from "./exports/timeline";
import { hyperframesRenderer, renderPlanGraphics, type GraphicOutcome } from "./graphics-render";
import { renderProblems } from "./lint";
import { EditPlan, type AutoEditMode } from "./plan-schema";
import {
  AutoEditFailure, claim, classify, graphicsParallelism, graphicsSummary, loadAdOrFail, renderVideo,
} from "./pipeline";
import { toolchainPaths, type ToolchainPaths } from "./toolchain";

const run = promisify(execFile);

/**
 * "Render MP4" and "Export project for..." on the render worker, against
 * the timeline snapshot stored on the ad_renders row. No Claude: these
 * cost render time only.
 *
 * Exports are stored as separate files (Supabase's upload limit is per
 * file) under the ad's folder and zipped in the browser on download;
 * each file is kept under UPLOAD_LIMIT_BYTES, re-encoding a ProRes
 * overlay at a lower quality if it would be over.
 */

export const UPLOAD_LIMIT_BYTES = 45 * 1024 * 1024;
const FINAL_TIMEOUT_MS = 12 * 60_000;

export type RenderRow = {
  id: string;
  org_id: string;
  brand_id: string;
  ad_id: string;
  kind: "mp4" | "export";
  format: ExportFormat | null;
  plan: EditPlan;
  mode: AutoEditMode;
  status: string;
  notes: string[];
  timings: Record<string, number>;
  started_at: string | null;
};

export type RenderOptions = {
  supabase: SupabaseClient;
  renderId: string;
  workRoot: string;
  machine?: string;
  paths?: ToolchainPaths;
  log?: (m: string, extra?: Record<string, unknown>) => void;
};

export async function runAdRender(o: RenderOptions): Promise<{ status: string }> {
  const { supabase, renderId } = o;
  const log = o.log ?? (() => {});
  const paths = o.paths ?? toolchainPaths();
  let row = await readRender(supabase, renderId);
  if (!["queued", "rendering"].includes(row.status)) return { status: row.status };

  const update = async (patch: Record<string, unknown>) => {
    const { data, error } = await supabase.from("ad_renders").update(patch).eq("id", renderId).select("*").single();
    if (error) throw new Error(`could not update the render: ${error.message}`);
    row = data as RenderRow;
  };
  const timed = async <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const r = await f();
    await update({ timings: { ...row.timings, [key]: Math.round(performance.now() - t0) } });
    return r;
  };

  await update({ status: "rendering", started_at: row.started_at ?? new Date().toISOString(), machine: o.machine ?? null, error: null, error_code: null });
  await claim(supabase, row.org_id, row.brand_id);

  const workDir = join(o.workRoot, renderId);
  await mkdir(workDir, { recursive: true });
  try {
    const ad = await timed("loadMs", () => loadAdOrFail(supabase, row.ad_id, paths, workDir, { frames: false }));
    const plan = EditPlan.parse(row.plan);
    const problems = renderProblems(plan, ad.lint);
    if (problems.length) {
      throw new AutoEditFailure("VALIDATION", `The timeline can't be rendered yet: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; ..." : ""}`);
    }

    const graphics = await timed("graphicsMs", () =>
      renderPlanGraphics(plan, hyperframesRenderer(paths, workDir), { parallel: graphicsParallelism(), log })
    );
    await update({ notes: graphicsSummary(graphics).filter((g) => g.fallback).map((g) => `Graphic ${g.id} used its Clean template: ${g.fallback}`) });

    if (row.kind === "mp4") {
      const out = await timed("renderMs", () => renderVideo(ad, plan, graphics, paths, workDir, "final", FINAL_EXPORT, FINAL_TIMEOUT_MS, log));
      const assetId = await saveVideoAsset(supabase, { orgId: row.org_id, adId: row.ad_id, id: row.id, mode: row.mode }, out);
      await update({ asset_id: assetId, status: "succeeded", finished_at: new Date().toISOString() });
      return { status: "succeeded" };
    }

    const bundle = await timed("bundleMs", () => buildBundle(row.format!, plan, ad, graphics, paths, workDir, log));
    const files = await timed("uploadMs", () => uploadBundle(supabase, row, bundle.dir));
    await update({ files, notes: [...(row.notes ?? []), ...bundle.notes], status: "succeeded", finished_at: new Date().toISOString() });
    return { status: "succeeded" };
  } catch (e) {
    throw classify(e);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

type Bundle = { dir: string; notes: string[] };

/** Lays out the export folder: media/ plus the format's project files. */
export async function buildBundle(
  format: ExportFormat, plan: EditPlan, ad: LoadedAd, graphics: GraphicOutcome[], paths: ToolchainPaths, workDir: string, log: (m: string) => void
): Promise<Bundle> {
  const dir = join(workDir, "bundle");
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "media"), { recursive: true });

  const media: ExportMedia = { scenes: {}, voiceovers: {}, graphics: {} };
  const abs = (rel: string) => join(dir, rel);
  const used = new Set(plan.clips.map((c) => c.scene));
  for (const scene of used) {
    const rel = `media/scene-${pad2(scene + 1)}.mp4`;
    if (format !== "capcut") await copyFile(ad.sceneFiles[scene], abs(rel));
    const m = ad.sceneMeta[scene];
    media.scenes[scene] = { file: rel, duration: ad.lint.clipDurations[scene], width: m.width, height: m.height, hasAudio: m.hasAudio };
  }
  for (const [scene, file] of Object.entries(ad.voiceoverFiles)) {
    if (!used.has(Number(scene))) continue;
    const rel = `media/voiceover-scene-${pad2(Number(scene) + 1)}${extname(file) || ".mp3"}`;
    await copyFile(file, abs(rel));
    media.voiceovers[Number(scene)] = { file: rel, duration: ad.lint.voiceoverDurations?.[Number(scene)] ?? 0 };
  }
  for (const g of graphics) {
    const pg = plan.graphics.find((x) => x.id === g.id)!;
    const rel = `media/graphic-${slug(g.id)}${extname(g.file)}`;
    await copyFile(g.file, abs(rel));
    await fitUnderLimit(abs(rel), paths, log);
    media.graphics[g.id] = { file: rel, duration: pg.duration, alpha: pg.layout === "overlay" };
  }

  const name = `autocut-${format}`;
  const text = exportText(format, plan, media, name);
  for (const f of text.files) await writeFile(abs(f.path), f.content);

  if (format === "capcut") {
    for (const cut of text.capcutCuts) {
      const src = ad.sceneFiles[Number(/scene-(\d+)/.exec(cut.source)![1]) - 1];
      await run(paths.ffmpeg, [
        "-v", "error", "-y", "-ss", cut.fromSeconds.toFixed(3), "-to", cut.toSeconds.toFixed(3), "-i", src,
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", abs(cut.out),
      ], { env: paths.concatEnv, timeout: 120_000 });
    }
  }

  if (format === "concat") {
    // Built through Concat's own API, then pointed at media/ by relative path.
    const rpc = new EngineProcess({ bin: paths.concatBin, env: paths.concatEnv, cwd: dir });
    try {
      await buildProject(rpc, {
        plan,
        sceneFiles: Object.fromEntries(Object.entries(media.scenes).map(([s, m]) => [s, abs(m.file)])),
        voiceoverFiles: Object.fromEntries(Object.entries(media.voiceovers).map(([s, m]) => [s, abs(m.file)])),
        graphicFiles: Object.fromEntries(Object.entries(media.graphics).map(([id, m]) => [id, abs(m.file)])),
        fontPath: "", location: dir, name: "project", log,
      });
    } finally {
      await rpc.close().catch(() => {});
    }
    const projectFile = join(dir, "project", "concat.json");
    const doc = JSON.parse(await readFile(projectFile, "utf8")) as { media?: { path: string }[] };
    for (const m of doc.media ?? []) m.path = relative(dir, m.path).split("\\").join("/");
    await writeFile(projectFile, JSON.stringify(doc));
    for (const f of CONCAT_PATH_SCRIPTS) await writeFile(abs(f.path), f.content, { mode: 0o755 });
  }
  return { dir, notes: text.notes };
}

/** Re-encodes a ProRes 4444 overlay at increasing quantisers until it fits the upload limit. */
async function fitUnderLimit(file: string, paths: ToolchainPaths, log: (m: string) => void): Promise<void> {
  if ((await stat(file)).size <= UPLOAD_LIMIT_BYTES) return;
  if (extname(file) !== ".mov") throw new Error(`${basename(file)} is over the ${UPLOAD_LIMIT_BYTES / 2 ** 20} MB upload limit`);
  for (const q of [8, 14, 22, 31]) {
    const tmp = `${file}.q${q}.mov`;
    await run(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-qscale:v", String(q), "-an", tmp], { env: paths.concatEnv, timeout: 180_000 });
    if ((await stat(tmp)).size <= UPLOAD_LIMIT_BYTES) {
      log(`${basename(file)}: re-encoded at qscale ${q} to fit the upload limit`);
      await rm(file);
      await copyFile(tmp, file);
      await rm(tmp);
      return;
    }
    await rm(tmp);
  }
  throw new Error(`${basename(file)} is still over the upload limit`);
}

export type BundleFile = { path: string; storagePath: string; bytes: number };

async function uploadBundle(supabase: SupabaseClient, r: RenderRow, dir: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  const all = await walk(dir);
  for (const [i, file] of all.entries()) {
    const rel = relative(dir, file).split("\\").join("/");
    const bytes = await readFile(file);
    if (bytes.length > UPLOAD_LIMIT_BYTES) throw new Error(`${rel} is over the upload limit`);
    // Storage keys stay ASCII; the bundle path travels in the manifest.
    const storagePath = `${r.org_id}/renders/${r.ad_id}/auto-edit/exports/${r.id}/${String(i + 1).padStart(3, "0")}${extname(file)}`;
    const { error } = await supabase.storage.from("renders").upload(storagePath, bytes, { contentType: contentType(file), upsert: true });
    if (error) throw new Error(`upload of ${rel} failed: ${error.message}`);
    files.push({ path: rel, storagePath, bytes: bytes.length });
  }
  return files;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

function contentType(file: string): string {
  const ext = extname(file).toLowerCase();
  return (
    { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".json": "application/json",
      ".xml": "application/xml", ".fcpxml": "application/xml", ".otio": "application/json", ".srt": "text/plain", ".txt": "text/plain", ".sh": "text/plain", ".ps1": "text/plain" } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

/** Uploads a rendered video to the ad's folder in the renders bucket and records it as an asset. */
export async function saveVideoAsset(
  supabase: SupabaseClient, r: { orgId: string; adId: string; id: string; mode: AutoEditMode }, file: string
): Promise<string> {
  const storagePath = `${r.orgId}/renders/${r.adId}/auto-edit/renders/${r.id}/final.mp4`;
  const bytes = await readFile(file);
  const { error: upErr } = await supabase.storage.from("renders").upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  const { data: last } = await supabase
    .from("assets").select("version").eq("ad_id", r.adId).eq("kind", "final").is("scene_id", null)
    .order("version", { ascending: false }).limit(1);
  const { data, error } = await supabase
    .from("assets")
    .insert({
      org_id: r.orgId,
      // Ad assets carry ad_id only (assets_ad_or_brand_check).
      ad_id: r.adId,
      scene_id: null,
      kind: "final",
      version: (last?.[0]?.version ?? 0) + 1,
      storage_path: storagePath,
      source: `auto-edit:${r.mode}`,
      meta: { autoEdit: { renderId: r.id, role: "final", mode: r.mode, bytes: bytes.length } },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not record the video: ${error?.message}`);
  return data.id as string;
}

async function readRender(supabase: SupabaseClient, id: string): Promise<RenderRow> {
  const { data, error } = await supabase.from("ad_renders").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`render ${id} not found (${error?.message ?? "no row"})`);
  return data as RenderRow;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "graphic";
