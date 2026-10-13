import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { SceneImageAsset } from "./scene-images-data";

/** Non-archived video assets for every scene of this ad, newest version last, grouped by scene. */
export async function getSceneVideos(orgId: string, adId: string): Promise<Record<string, SceneImageAsset[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "video")
    .eq("archived", false)
    .order("version", { ascending: true });

  if (error) throw new Error(error.message);
  return groupByScene(data ?? []);
}

/** Archived video assets (spec §5.8: "an 'archived videos' strip lets the editor restore them") — archived by generateSceneImages() as a side effect whenever a scene that already has videos gets a new image. */
export async function getArchivedSceneVideos(orgId: string, adId: string): Promise<Record<string, SceneImageAsset[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "video")
    .eq("archived", true)
    .order("version", { ascending: true });

  if (error) throw new Error(error.message);
  return groupByScene(data ?? []);
}

function groupByScene(rows: SceneImageAsset[]): Record<string, SceneImageAsset[]> {
  const bySceneId: Record<string, SceneImageAsset[]> = {};
  for (const asset of rows) {
    if (!asset.scene_id) continue;
    (bySceneId[asset.scene_id] ??= []).push(asset);
  }
  return bySceneId;
}

/**
 * Jobs rows relevant to Scene videos for this ad — the UI's source of
 * truth for "is a video generation in flight for this scene" (spec
 * §5.7: "Jobs run server side and survive tab closes and reloads," so
 * the client must never rely on its own in-memory state alone to know
 * a job is running; it re-derives this on every page load instead).
 * Only non-terminal jobs are returned — a succeeded/failed/cancelled
 * job has nothing left to poll for.
 */
export type SceneVideoJob = {
  id: string;
  scene_id: string;
  status: string;
  created_at: string;
};

export async function getActiveSceneVideoJobs(orgId: string, adId: string): Promise<Record<string, SceneVideoJob>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, scene_id, status, created_at")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "generate_scene_video")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // One scene could in theory have more than one in-flight job row
  // (e.g. a retry) — keep only the most recent per scene, since the
  // UI shows exactly one in-flight state per scene card.
  const bySceneId: Record<string, SceneVideoJob> = {};
  for (const job of data ?? []) {
    if (!job.scene_id) continue;
    if (!bySceneId[job.scene_id]) bySceneId[job.scene_id] = job;
  }
  return bySceneId;
}

/** Signed URLs for scene video/image storage paths — same helper shape as scene-images-data.ts's getAssetSignedUrlsByPath, kept local since this reads the service client (videos are service-role-written, same as images). */
export async function getSceneVideoSignedUrls(storagePaths: string[]): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const service = createServiceClient();
  const { data, error } = await service.storage.from("renders").createSignedUrls(storagePaths, 3600);
  if (error) throw new Error(error.message);

  const result: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) result[entry.path] = entry.signedUrl;
  }
  return result;
}

/**
 * Per-scene voiceover (spec §5.4 bullet 5 / §5.11 bullet 5, redone to
 * be scene-scoped — see voiceover-step.tsx). Each entry is the
 * latest non-archived kind='vo' asset for that scene plus its
 * matching kind='caption' asset if one exists, grouped by scene_id.
 * Replaces the old getLatestAdVoiceover (which read scene_id IS NULL
 * — the whole-ad shape this redo replaces).
 */
export type SceneVoiceover = { voAsset: SceneImageAsset; captionAsset: SceneImageAsset | null };

export async function getSceneVoiceovers(orgId: string, adId: string): Promise<Record<string, SceneVoiceover>> {
  const service = createServiceClient();
  const { data: voAssets, error: voError } = await service
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "vo")
    .eq("archived", false)
    .not("scene_id", "is", null)
    .order("version", { ascending: false });
  if (voError) throw new Error(voError.message);

  const { data: captionAssets, error: captionError } = await service
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "caption")
    .eq("archived", false)
    .not("scene_id", "is", null)
    .order("version", { ascending: false });
  if (captionError) throw new Error(captionError.message);

  const latestCaptionBySceneId = new Map<string, SceneImageAsset>();
  for (const asset of captionAssets ?? []) {
    if (!asset.scene_id) continue;
    if (!latestCaptionBySceneId.has(asset.scene_id)) latestCaptionBySceneId.set(asset.scene_id, asset);
  }

  const result: Record<string, SceneVoiceover> = {};
  for (const asset of voAssets ?? []) {
    if (!asset.scene_id) continue;
    if (result[asset.scene_id]) continue; // voAssets is ordered newest-first per overall query; first hit per scene is the latest
    result[asset.scene_id] = { voAsset: asset, captionAsset: latestCaptionBySceneId.get(asset.scene_id) ?? null };
  }
  return result;
}

/**
 * The current (non-archived) `vo` asset for ONE scene, if any — used
 * by scene-videos-actions.ts to resolve `referenceAudioUrls` for video
 * generation. Optional by design: scene video generation must keep
 * working with no voiceover at all (spec: "no new hard dependency").
 */
export async function getCurrentSceneVoiceoverAsset(orgId: string, sceneId: string): Promise<SceneImageAsset | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "vo")
    .eq("archived", false)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Jobs rows relevant to per-scene voiceover generation for this ad — same "survive reload" pattern as getActiveSceneVideoJobs. */
export type SceneVoiceoverJob = { id: string; scene_id: string; status: string; created_at: string };

export async function getActiveSceneVoiceoverJobs(orgId: string, adId: string): Promise<Record<string, SceneVoiceoverJob>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, scene_id, status, created_at")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "generate_scene_voiceover")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const bySceneId: Record<string, SceneVoiceoverJob> = {};
  for (const job of data ?? []) {
    if (!job.scene_id) continue;
    if (!bySceneId[job.scene_id]) bySceneId[job.scene_id] = job;
  }
  return bySceneId;
}
