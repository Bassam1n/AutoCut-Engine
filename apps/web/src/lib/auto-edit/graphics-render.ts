import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { documentFor, resolveGraphic, templateCode } from "./graphics-sandbox";
import type { EditPlan, PlanGraphic } from "./plan-schema";
import type { ToolchainPaths } from "./toolchain";

const run = promisify(execFile);

/** A graphic that takes longer than this to render is killed (and falls back to its template). */
export const GRAPHIC_RENDER_TIMEOUT_MS = 120_000;

export type GraphicCode = { css: string; html: string; js: string };

export type RenderOne = (g: PlanGraphic, code: GraphicCode) => Promise<{ file: string; ms: number; cached: boolean }>;

/**
 * Renders one graphic with Hyperframes: ProRes 4444 .mov for overlays
 * (the render engine keeps its alpha; VP9 .webm loses it) or MP4 for
 * full-frame cards. Cached by content hash in workDir, so after a review
 * fix only the graphics that changed render again.
 */
export function hyperframesRenderer(paths: ToolchainPaths, workDir: string, timeoutMs = GRAPHIC_RENDER_TIMEOUT_MS): RenderOne {
  return async (g, code) => {
    const opaque = g.layout === "fullFrame";
    const id = g.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "graphic";
    const doc = documentFor(id, g.duration, code, opaque);
    const hash = createHash("sha256").update(doc).digest("hex").slice(0, 12);
    const dir = join(workDir, "hf", `${id}-${hash}`);
    const file = join(workDir, "graphics", `${id}-${hash}.${opaque ? "mp4" : "mov"}`);
    if (await stat(file).then((s) => s.size > 0, () => false)) return { file, ms: 0, cached: true };
    await mkdir(dir, { recursive: true });
    await mkdir(join(workDir, "graphics"), { recursive: true });
    await writeFile(join(dir, "index.html"), doc);
    await copyFile(paths.gsapJs, join(dir, "gsap.min.js"));
    const t0 = performance.now();
    try {
      await run(paths.hyperframesBin, ["render", "--format", opaque ? "mp4" : "mov", "--output", file], {
        cwd: dir, env: paths.hyperframesEnv, maxBuffer: 1 << 26, timeout: timeoutMs, killSignal: "SIGKILL",
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
      const why = err.killed ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `${String(err.stdout ?? "").slice(-800)}${String(err.stderr ?? "").slice(-800)}` || err.message;
      throw new Error(`Hyperframes render of ${g.id} failed: ${why}`);
    }
    return { file, ms: Math.round(performance.now() - t0), cached: false };
  };
}

export type GraphicOutcome = {
  id: string;
  file: string;
  source: "designed" | "template";
  ms: number;
  cached: boolean;
  /** Set when a designed graphic was replaced by its template, and why. */
  fallback?: string;
};

/**
 * Renders every graphic in the plan, `parallel` at a time. A designed
 * graphic that fails the sandbox checks, or fails or times out while
 * rendering, is replaced by its template; a template that fails is an
 * error.
 */
export async function renderPlanGraphics(
  plan: EditPlan,
  render: RenderOne,
  { parallel, log = () => {} }: { parallel: number; log?: (m: string) => void }
): Promise<GraphicOutcome[]> {
  const out: GraphicOutcome[] = new Array(plan.graphics.length);
  let next = 0;
  const worker = async () => {
    while (next < plan.graphics.length) {
      const i = next++;
      const g = plan.graphics[i];
      const resolved = resolveGraphic(g);
      if (resolved.fallbackReasons.length) log(`graphic ${g.id}: using its template (${resolved.fallbackReasons.join("; ")})`);
      try {
        const r = await render(g, resolved.code);
        out[i] = {
          id: g.id, file: r.file, source: resolved.source, ms: r.ms, cached: r.cached,
          ...(resolved.fallbackReasons.length ? { fallback: `failed sandbox checks: ${resolved.fallbackReasons.join("; ")}` } : {}),
        };
      } catch (e) {
        if (resolved.source !== "designed") throw e;
        const reason = e instanceof Error ? e.message : String(e);
        log(`graphic ${g.id}: designed version failed to render, using its template (${reason.slice(0, 300)})`);
        const r = await render(g, templateCode(g));
        out[i] = { id: g.id, file: r.file, source: "template", ms: r.ms, cached: r.cached, fallback: `render failed: ${reason.slice(0, 500)}` };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, plan.graphics.length)) }, worker));
  return out;
}
