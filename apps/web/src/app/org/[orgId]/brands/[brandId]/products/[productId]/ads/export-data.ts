"use server";

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd } from "@/lib/access";
import type { DownloadableAsset } from "@/lib/download/zip-naming";

export type ExportManifestEntry = DownloadableAsset & { signedUrl: string | null };

/**
 * Every non-archived image/video/voiceover/caption asset for one ad,
 * scoped by scene, with a signed URL for each. Supersedes the old
 * download-actions.ts's getDownloadManifest (images/videos only) now
 * that Export is its own Studio step covering every asset kind an
 * editor hands off to their external editing tool (founder's explicit
 * call: this app's job ends at "give me my files," captions/trimming/
 * compositing stay in CapCut/Premiere/etc, not built here).
 *
 * Same batched-signing pattern as every other asset query in this
 * app: one createSignedUrls() call for every storage_path, not one
 * call per file.
 */
export async function getExportManifest(orgId: string, adId: string): Promise<ExportManifestEntry[]> {
  await requireOrgMember(orgId);
  // Callable from the browser and signs every file of the ad with the
  // service role, so the ad must be one the caller can see.
  if (!(await getAccessibleAd(orgId, adId))) throw new Error("Ad not found.");

  const service = createServiceClient();
  const { data: assets, error } = await service
    .from("assets")
    .select("id, kind, storage_path, scene_id, version")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .in("kind", ["image", "video", "vo", "caption"])
    .eq("archived", false)
    .order("version", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = assets ?? [];
  if (rows.length === 0) return [];

  const { data: scenes, error: scenesError } = await service
    .from("scenes")
    .select("id, idx")
    .eq("org_id", orgId)
    .eq("ad_id", adId);
  if (scenesError) throw new Error(scenesError.message);
  const sceneIdxById = new Map((scenes ?? []).map((s) => [s.id, s.idx as number]));

  // Per-scene running count of images, assigned in version order —
  // same reasoning as getDownloadManifest: stable "image-1"/"image-2"
  // numbering matching generation order, not arbitrary DB order.
  const imageCountBySceneId = new Map<string, number>();

  // A scene's vo/caption are each kept to its single latest
  // (non-archived) version only — unlike images, there's no "which
  // take did I generate first" numbering an editor needs for
  // voiceover; getSceneVoiceovers() elsewhere in this app applies the
  // same "latest only" rule for the same reason.
  const latestVoBySceneId = new Map<string, (typeof rows)[number]>();
  const latestCaptionBySceneId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!row.scene_id) continue;
    if (row.kind === "vo") {
      const current = latestVoBySceneId.get(row.scene_id);
      if (!current || row.version > current.version) latestVoBySceneId.set(row.scene_id, row);
    } else if (row.kind === "caption") {
      const current = latestCaptionBySceneId.get(row.scene_id);
      if (!current || row.version > current.version) latestCaptionBySceneId.set(row.scene_id, row);
    }
  }
  const latestVoAssetIds = new Set([...latestVoBySceneId.values()].map((r) => r.id));
  const latestCaptionAssetIds = new Set([...latestCaptionBySceneId.values()].map((r) => r.id));

  const storagePaths = rows.map((r) => r.storage_path);
  const { data: signedData } = await service.storage.from("renders").createSignedUrls(storagePaths, 3600);
  const signedByPath = new Map((signedData ?? []).map((d) => [d.path, d.signedUrl]));

  const manifest: ExportManifestEntry[] = [];
  for (const row of rows) {
    if (row.kind === "vo" && !latestVoAssetIds.has(row.id)) continue;
    if (row.kind === "caption" && !latestCaptionAssetIds.has(row.id)) continue;

    const sceneIdx = row.scene_id ? sceneIdxById.get(row.scene_id) ?? null : null;
    let imageIndexInScene: number | undefined;
    if (row.kind === "image" && row.scene_id) {
      const next = (imageCountBySceneId.get(row.scene_id) ?? 0) + 1;
      imageCountBySceneId.set(row.scene_id, next);
      imageIndexInScene = next;
    }

    manifest.push({
      assetId: row.id,
      storagePath: row.storage_path,
      kind: row.kind as "image" | "video" | "vo" | "caption",
      sceneIdx,
      imageIndexInScene,
      signedUrl: row.storage_path ? signedByPath.get(row.storage_path) ?? null : null,
    });
  }

  return manifest;
}
