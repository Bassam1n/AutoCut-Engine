import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdContext, FrameImage } from "./director";
import type { LintContext } from "./lint";
import type { ToolchainPaths } from "./toolchain";

const run = promisify(execFile);

/**
 * Everything the worker reads about an ad before Claude plans it: the
 * script and scenes, each scene's current video, any voiceover with its
 * word timings, and the brand's look. Media is downloaded into workDir.
 */

/** Video models that take the scene's voiceover as reference audio, so their clip already carries the spoken line (see KieAdapter). */
const VOICE_IN_CLIP_MODELS = new Set(["bytedance/seedance-2", "bytedance/seedance-2-5", "kling-3.0/video"]);

export class AdNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdNotReadyError";
  }
}

type AssetRow = {
  id: string;
  kind: string;
  scene_id: string | null;
  version: number;
  storage_path: string;
  source: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type Voiceover = {
  /** "separate": its own audio track from the scene's first clip; "inClip": already in the clip's audio. */
  mode: "separate" | "inClip";
  file: string;
  duration: number;
  words: { text: string; start: number; end: number }[];
};

export type LoadedAd = {
  orgId: string;
  brandId: string;
  adId: string;
  targetLengthSeconds: number;
  /** Local scene clip files by scene index. */
  sceneFiles: Record<number, string>;
  /** Separate voiceovers by scene index (inClip ones are left out: the clip carries them). */
  voiceoverFiles: Record<number, string>;
  lint: LintContext;
  context: AdContext;
};

/** Newest non-archived asset of a kind for each scene. */
function latestByScene(rows: AssetRow[], kind: string): Map<string, AssetRow> {
  const out = new Map<string, AssetRow>();
  for (const r of rows) {
    if (r.kind !== kind || !r.scene_id) continue;
    const cur = out.get(r.scene_id);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.created_at > cur.created_at)) out.set(r.scene_id, r);
  }
  return out;
}

async function download(supabase: SupabaseClient, path: string, to: string): Promise<string> {
  const { data, error } = await supabase.storage.from("renders").download(path);
  if (error || !data) throw new Error(`could not download ${path}: ${error?.message ?? "no data"}`);
  await writeFile(to, Buffer.from(await data.arrayBuffer()));
  return to;
}

export async function probeDuration(paths: ToolchainPaths, file: string): Promise<number> {
  const { stdout } = await run(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { env: paths.concatEnv });
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`could not read the length of ${file}`);
  return Math.round(d * 1000) / 1000;
}

/** One JPEG frame at t seconds, `width` px wide. */
export async function frameAt(paths: ToolchainPaths, video: string, t: number, out: string, width = 360): Promise<Buffer> {
  await run(paths.ffmpeg, ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out], { env: paths.concatEnv });
  return readFile(out);
}

export async function loadAd(supabase: SupabaseClient, adId: string, paths: ToolchainPaths, workDir: string): Promise<LoadedAd> {
  const { data: ad, error: adError } = await supabase
    .from("ads")
    .select("id, org_id, brand_id, product_id, name, target_length_seconds, brief")
    .eq("id", adId)
    .single();
  if (adError || !ad) throw new Error(`ad ${adId} not found`);

  const [{ data: brand }, { data: product }, { data: scenes }, { data: assets }] = await Promise.all([
    supabase.from("brands").select("name, brand_context").eq("id", ad.brand_id).single(),
    ad.product_id
      ? supabase.from("products").select("name, what_it_is, category, real_world_size").eq("id", ad.product_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("scenes").select("id, idx, hook_group, copy, visual, duration_s, speaker").eq("ad_id", adId).order("idx"),
    supabase
      .from("assets")
      .select("id, kind, scene_id, version, storage_path, source, meta, created_at")
      .eq("ad_id", adId)
      .eq("archived", false)
      .in("kind", ["video", "vo", "caption"]),
  ]);
  if (!scenes?.length) throw new AdNotReadyError("This ad has no scenes yet.");

  const rows = (assets ?? []) as AssetRow[];
  const videos = latestByScene(rows, "video");
  const vos = latestByScene(rows, "vo");
  const captions = latestByScene(rows, "caption");
  const missing = scenes.filter((s) => !videos.has(s.id)).map((s) => s.idx + 1);
  if (missing.length) {
    throw new AdNotReadyError(`Scene${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "have" : "has"} no video yet. Generate every scene's video first.`);
  }

  await mkdir(join(workDir, "media"), { recursive: true });
  await mkdir(join(workDir, "frames"), { recursive: true });

  const sceneFiles: Record<number, string> = {};
  const voiceoverFiles: Record<number, string> = {};
  const clipDurations: Record<number, number> = {};
  const voiceoverDurations: Record<number, number> = {};
  const frames: FrameImage[] = [];
  const adScenes: Record<string, unknown>[] = [];

  for (const s of scenes) {
    const video = videos.get(s.id)!;
    const file = await download(supabase, video.storage_path, join(workDir, "media", `scene-${s.idx}.mp4`));
    const duration = await probeDuration(paths, file);
    sceneFiles[s.idx] = file;
    clipDurations[s.idx] = duration;
    const ts = [0.15, 0.5, 0.85].map((f) => +(duration * f).toFixed(2));
    for (const [i, t] of ts.entries()) {
      frames.push({ label: `Scene ${s.idx}, ${t.toFixed(1)}s into its clip:`, jpeg: await frameAt(paths, file, t, join(workDir, "frames", `s${s.idx}-${i}.jpg`)) });
    }

    let voiceover: Voiceover | null = null;
    const vo = vos.get(s.id);
    if (vo) {
      const voFile = await download(supabase, vo.storage_path, join(workDir, "media", `vo-${s.idx}${vo.storage_path.match(/\.\w+$/)?.[0] ?? ".mp3"}`));
      const caption = captions.get(s.id);
      const words = Array.isArray(caption?.meta?.words) ? (caption!.meta!.words as Voiceover["words"]) : [];
      const inClip = VOICE_IN_CLIP_MODELS.has(video.source ?? "") && vo.created_at < video.created_at;
      voiceover = { mode: inClip ? "inClip" : "separate", file: voFile, duration: await probeDuration(paths, voFile), words };
      if (!inClip) {
        voiceoverFiles[s.idx] = voFile;
        voiceoverDurations[s.idx] = voiceover.duration;
      }
    }

    adScenes.push({
      index: s.idx,
      role: s.hook_group,
      copy: s.copy,
      visual: s.visual,
      plannedDuration: s.duration_s,
      clipDuration: duration,
      voiceover: voiceover
        ? {
            mode: voiceover.mode,
            duration: voiceover.duration,
            words: voiceover.words.map((w) => ({ w: w.text, s: +w.start.toFixed(2), e: +w.end.toFixed(2) })),
          }
        : null,
    });
  }

  const brandContext = (brand?.brand_context ?? {}) as Record<string, unknown>;
  const hasVoice = adScenes.some((s) => s.voiceover);
  return {
    orgId: ad.org_id,
    brandId: ad.brand_id,
    adId,
    targetLengthSeconds: ad.target_length_seconds ?? 30,
    sceneFiles,
    voiceoverFiles,
    lint: { targetLengthSeconds: ad.target_length_seconds ?? 30, clipDurations, voiceoverDurations },
    context: {
      ad: {
        name: ad.name,
        brand: { name: brand?.name ?? null, ...brandContext },
        product: product ?? null,
        targetLengthSeconds: ad.target_length_seconds ?? 30,
        aspect: "9:16",
        voiceoverNote: hasVoice
          ? "Some scenes have a voiceover with word timings; captions follow the spoken words."
          : "This ad has no voiceover. The clips carry only their own sound, so the captions carry the script.",
        scenes: adScenes,
      },
      frames,
    },
  };
}
