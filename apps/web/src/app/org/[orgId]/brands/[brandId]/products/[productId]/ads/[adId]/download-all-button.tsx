"use client";

import { useState } from "react";
import JSZip from "jszip";
import { AsyncButton } from "@/components/async-button";
import { getDownloadManifest } from "../download-actions";
import { buildZipManifest, extensionFromStoragePath, type DownloadScope } from "@/lib/download/zip-naming";

/**
 * "Download all" (spec §5.9): "one zip with files named by scene
 * (01.mp4, 01-image-1.png, transitions 01-02.mp4), choice of
 * everything, images only or videos only, built client side from
 * signed URLs." Placement: the ad's Studio page (scene_videos step,
 * the last step — by the time an editor reaches it, both images and
 * videos exist to download), rather than Creative history, since
 * Creative history is a cross-ad list with no per-ad asset detail
 * loaded at all — adding a per-row download there would mean a whole
 * second data-fetch path just for that list, while Studio already has
 * everything scoped to one ad front and center.
 */
export function DownloadAllButton({ orgId, adId, adName }: { orgId: string; adId: string; adName: string }) {
  const [scope, setScope] = useState<DownloadScope>("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setError(null);
    setIsDownloading(true);
    try {
      const manifest = await getDownloadManifest(orgId, adId);
      if (manifest.length === 0) {
        setError("Nothing to download yet — generate at least one scene image or video first.");
        return;
      }

      const entries = buildZipManifest(manifest, scope, (asset) => extensionFromStoragePath(asset.storagePath));
      if (entries.length === 0) {
        setError(`No ${scope === "images" ? "images" : "videos"} to download for this ad yet.`);
        return;
      }

      const zip = new JSZip();
      const bySignedUrl = new Map(manifest.map((m) => [m.assetId, m.signedUrl]));

      // Sequential, not Promise.all — several multi-MB video fetches
      // in parallel risk saturating the browser's own per-origin
      // connection limit and a slow mobile connection; a short, linear
      // wait is a better trade for a feature the editor runs once per
      // finished ad, not on every click.
      for (const { asset, zipPath } of entries) {
        const url = bySignedUrl.get(asset.assetId);
        if (!url) continue; // a signed URL can fail to generate (storage hiccup) — skip rather than fail the whole zip
        const res = await fetch(url);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        zip.file(zipPath, bytes);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${slugify(adName)}-${scope}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background-raised/50 p-3">
      <span className="text-xs font-medium text-foreground-muted">Download all</span>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value as DownloadScope)}
        className="rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs"
      >
        <option value="all">Everything</option>
        <option value="images">Images only</option>
        <option value="videos">Videos only</option>
      </select>
      <AsyncButton
        onClick={onDownload}
        isPending={isDownloading}
        pendingLabel="Zipping..."
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Download zip
      </AsyncButton>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "ad";
}
