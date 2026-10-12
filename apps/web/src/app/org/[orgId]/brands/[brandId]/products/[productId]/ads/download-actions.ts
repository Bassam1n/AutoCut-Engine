"use server";

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import type { DownloadableAsset } from "@/lib/download/zip-naming";

export type DownloadManifestEntry = DownloadableAsset & { signedUrl: string | null };

/**
 * Every non-archived image/video asset for one ad, scoped by scene,
 * with a signed URL for each — spec §5.9: "Download all... built
 * client side from signed URLs." The actual zip is assembled in the
 * browser (download-zip.ts, fetch + JSZip), this action only resolves
 * which assets exist and signs them; no provider URL is ever reused
 * past its own expiry since these are always our own Storage-signed
 * URLs, never a provider's.
 *
 * Transitions (spec §5.9's "01-02.mp4" example): M7 explicitly
 * deferred the transition-clip system itself — no assets.kind for a
 * transition exists in this schema (migration 8's kind check list has
 * no 'transition' value), so none are ever returned here. The zip-
 * naming logic (zip-naming.ts) still supports a transition entry
 * shape so it's ready the day a transition asset kind is added, but
 * this action deliberately returns an empty set for that kind rather
 * than fabricating a placeholder file — handling the absence
 * gracefully, per the task's explicit instruction, not building the
 * system itself.
 */
export async function getDownloadManifest(orgId: string, adId: string): Promise<DownloadManifestEntry[]> {
  await requireOrgMember(orgId);

  const service = createServiceClient();
  const { data: assets, error } = await service
    .from("assets")
    .select("id, kind, storage_path, scene_id, version")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .in("kind", ["image", "video"])
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

  // Per-scene running count of images, assigned in version order (the
  // same "earliest-first" order generateSceneImages() writes them in)
  // so "image-1"/"image-2" is stable and matches which image an
  // editor generated first for that scene, not an arbitrary DB order.
  const imageCountBySceneId = new Map<string, number>();

  const storagePaths = rows.map((r) => r.storage_path);
  const { data: signedData } = await service.storage.from("renders").createSignedUrls(storagePaths, 3600);
  const signedByPath = new Map((signedData ?? []).map((d) => [d.path, d.signedUrl]));

  const manifest: DownloadManifestEntry[] = [];
  for (const row of rows) {
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
      kind: row.kind as "image" | "video",
      sceneIdx,
      imageIndexInScene,
      signedUrl: row.storage_path ? signedByPath.get(row.storage_path) ?? null : null,
    });
  }

  return manifest;
}
