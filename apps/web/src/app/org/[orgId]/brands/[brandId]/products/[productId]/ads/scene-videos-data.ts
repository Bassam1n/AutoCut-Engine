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
