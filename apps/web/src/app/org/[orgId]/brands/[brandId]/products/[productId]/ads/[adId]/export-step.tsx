"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { AsyncButton } from "@/components/async-button";
import { getExportManifest, type ExportManifestEntry } from "../export-data";
import { buildZipManifest, extensionFromStoragePath, type DownloadScope } from "@/lib/download/zip-naming";
import type { Ad } from "../ads-data";
import type { Scene } from "../scenes-data";

/**
 * Export — the real final Studio step (founder's explicit scoping
 * call): this app's job ends at handing the editor a clean, organized
 * set of every generated asset for an ad (scene images, scene videos,
 * voiceover audio, SRT captions). No burned-in captions, no trimming/
 * reordering, no compositing — those stay in the editor's own tool
 * (CapCut/Premiere/etc), which already does them well and is what
 * editors already know. Supersedes the old scene-videos-step.tsx
 * inline DownloadAllButton (images/videos only) with a dedicated step
 * that also covers voiceover/captions and gives each scene its own
 * clearly organized section, not just one flat zip button.
 *
 * Reuses download-all-button.tsx's proven approach exactly: JSZip,
 * client-side, sequential fetch+zip (not Promise.all — avoids
 * saturating the browser's per-origin connection limit on several
 * multi-MB video fetches), batched createSignedUrls from the server.
 */
export function ExportStep({
  orgId,
  ad,
  scenes,
}: {
  orgId: string;
  ad: Ad;
  scenes: Scene[];
}) {
  const [manifest, setManifest] = useState<ExportManifestEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<DownloadScope>("all");
  const [isZipping, setIsZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getExportManifest(orgId, ad.id);
        if (!cancelled) setManifest(result);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load assets.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, ad.id]);

  async function onDownloadZip() {
    if (!manifest) return;
    setZipError(null);
    setIsZipping(true);
    try {
      const entries = buildZipManifest(manifest, scope, (asset) => extensionFromStoragePath(asset.storagePath));
      if (entries.length === 0) {
        setZipError(`Nothing to download for "${scopeLabel(scope)}" yet.`);
        return;
      }

      const zip = new JSZip();
      const bySignedUrl = new Map(manifest.map((m) => [m.assetId, m.signedUrl]));

      for (const { asset, zipPath } of entries) {
        const url = bySignedUrl.get(asset.assetId);
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        zip.file(zipPath, bytes);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${slugify(ad.name ?? "ad")}-${scope}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setIsZipping(false);
    }
  }

  const bySceneId = new Map<string, ExportManifestEntry[]>();
  for (const entry of manifest ?? []) {
    const sceneId = scenes.find((s) => s.idx === entry.sceneIdx)?.id;
    if (!sceneId) continue;
    (bySceneId.get(sceneId) ?? bySceneId.set(sceneId, []).get(sceneId)!).push(entry);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Export</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Every generated asset for this ad, organized by scene. Download
          everything as one zip, or grab individual files below — then bring
          them into your own editing tool for captions, trimming, and the
          final cut.
        </p>
      </div>

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
          <option value="voiceover">Voiceover + captions only</option>
        </select>
        <AsyncButton
          onClick={onDownloadZip}
          isPending={isZipping}
          pendingLabel="Zipping..."
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Download zip
        </AsyncButton>
        {zipError && <p className="w-full text-xs text-danger">{zipError}</p>}
      </div>

      {loadError && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{loadError}</p>
      )}

      {!manifest && !loadError && <p className="text-sm text-foreground-muted">Loading assets…</p>}

      {manifest && manifest.length === 0 && (
        <p className="text-sm text-foreground-muted">
          Nothing generated yet — go back and generate at least one scene image, video, or
          voiceover clip first.
        </p>
      )}

      {manifest && manifest.length > 0 && (
        <div className="flex flex-col gap-4">
          {scenes.map((scene) => {
            const entries = bySceneId.get(scene.id) ?? [];
            if (entries.length === 0) return null;
            return <SceneExportCard key={scene.id} scene={scene} entries={entries} />;
          })}
        </div>
      )}
    </div>
  );
}

function SceneExportCard({ scene, entries }: { scene: Scene; entries: ExportManifestEntry[] }) {
  const images = entries.filter((e) => e.kind === "image");
  const video = entries.find((e) => e.kind === "video");
  const vo = entries.find((e) => e.kind === "vo");
  const caption = entries.find((e) => e.kind === "caption");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
      <div className="flex flex-wrap gap-2">
        {video && <ExportLink label="Video" entry={video} />}
        {images.map((img, i) => (
          <ExportLink key={img.assetId} label={`Image ${i + 1}`} entry={img} />
        ))}
        {vo && <ExportLink label="Voiceover" entry={vo} />}
        {caption && <ExportLink label="Captions (SRT)" entry={caption} />}
      </div>
    </div>
  );
}

function ExportLink({ label, entry }: { label: string; entry: ExportManifestEntry }) {
  if (!entry.signedUrl) {
    return <span className="rounded-lg border border-border-strong px-2.5 py-1.5 text-xs text-foreground-muted">{label} (unavailable)</span>;
  }
  return (
    <a
      href={entry.signedUrl}
      download
      className="rounded-lg border border-border-strong px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-border/40"
    >
      ↓ {label}
    </a>
  );
}

function scopeLabel(scope: DownloadScope): string {
  if (scope === "images") return "images";
  if (scope === "videos") return "videos";
  if (scope === "voiceover") return "voiceover + captions";
  return "everything";
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "ad";
}
