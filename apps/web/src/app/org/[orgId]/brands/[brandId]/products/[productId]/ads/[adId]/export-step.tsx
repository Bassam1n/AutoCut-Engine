"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { AsyncButton } from "@/components/async-button";
import { AutoEditPanel } from "./auto-edit-panel";
import { MediaLightbox } from "@/components/media-lightbox";
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
 *
 * Thumbnails + per-asset selection (user feedback after first ship):
 * an editor needs to SEE each image/video before deciding what to
 * take, and should be able to hand-pick exactly the assets they want
 * across every scene into one zip, not just a blanket
 * everything/images/videos/voiceover scope filter.
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ kind: "image" | "video"; url: string; alt: string } | null>(null);

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

  function toggleSelected(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  async function downloadEntries(entries: ExportManifestEntry[], zipNameSuffix: string) {
    setZipError(null);
    setIsZipping(true);
    try {
      const zipManifest = buildZipManifest(entries, "all", (asset) => extensionFromStoragePath(asset.storagePath));
      if (zipManifest.length === 0) {
        setZipError("Nothing to download.");
        return;
      }

      const zip = new JSZip();
      const bySignedUrl = new Map(entries.map((m) => [m.assetId, m.signedUrl]));

      // Sequential, not Promise.all — several multi-MB video fetches
      // in parallel risk saturating the browser's own per-origin
      // connection limit.
      for (const { asset, zipPath } of zipManifest) {
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
      link.download = `${slugify(ad.name ?? "ad")}-${zipNameSuffix}.zip`;
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

  async function onDownloadZip() {
    if (!manifest) return;
    const entries = manifest.filter((e) => {
      if (scope === "images") return e.kind === "image";
      if (scope === "videos") return e.kind === "video";
      if (scope === "voiceover") return e.kind === "vo" || e.kind === "caption";
      return true;
    });
    if (entries.length === 0) {
      setZipError(`Nothing to download for "${scopeLabel(scope)}" yet.`);
      return;
    }
    await downloadEntries(entries, scope);
  }

  async function onDownloadSelected() {
    if (!manifest) return;
    const entries = manifest.filter((e) => selected.has(e.assetId));
    if (entries.length === 0) {
      setZipError("Select at least one asset first.");
      return;
    }
    await downloadEntries(entries, "selected");
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
          Every generated asset for this ad, organized by scene. Preview and
          hand-pick exactly what you want, or download everything at once —
          then bring the files into your own editing tool for captions,
          trimming, and the final cut. Or let Auto-edit cut the final video
          for you.
        </p>
      </div>

      <AutoEditPanel orgId={orgId} adId={ad.id} adName={ad.name ?? "ad"} />

      <div className="card-inset flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">Download all</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as DownloadScope)}
            className="field field-sm"
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
            className="btn-primary btn-sm"
          >
            Download zip
          </AsyncButton>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <AsyncButton
            onClick={onDownloadSelected}
            isPending={isZipping}
            pendingLabel="Zipping..."
            disabled={selected.size === 0}
            className="btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </AsyncButton>
        </div>
        {zipError && <p className="text-xs text-danger">{zipError}</p>}
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
            return (
              <SceneExportCard
                key={scene.id}
                scene={scene}
                entries={entries}
                selected={selected}
                onToggle={toggleSelected}
                onPreview={setPreview}
              />
            );
          })}
        </div>
      )}

      {preview && (
        <MediaLightbox kind={preview.kind} url={preview.url} alt={preview.alt} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function SceneExportCard({
  scene,
  entries,
  selected,
  onToggle,
  onPreview,
}: {
  scene: Scene;
  entries: ExportManifestEntry[];
  selected: Set<string>;
  onToggle: (assetId: string) => void;
  onPreview: (preview: { kind: "image" | "video"; url: string; alt: string }) => void;
}) {
  const images = entries.filter((e) => e.kind === "image");
  const video = entries.find((e) => e.kind === "video");
  const vo = entries.find((e) => e.kind === "vo");
  const caption = entries.find((e) => e.kind === "caption");

  return (
    <div className="card-inset flex flex-col gap-3 p-4">
      <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
      <div className="flex flex-wrap gap-3">
        {video && (
          <AssetTile
            label="Video"
            entry={video}
            isSelected={selected.has(video.assetId)}
            onToggle={() => onToggle(video.assetId)}
            onPreview={() => video.signedUrl && onPreview({ kind: "video", url: video.signedUrl, alt: `Scene ${scene.idx + 1} video` })}
          />
        )}
        {images.map((img, i) => (
          <AssetTile
            key={img.assetId}
            label={`Image ${i + 1}`}
            entry={img}
            isSelected={selected.has(img.assetId)}
            onToggle={() => onToggle(img.assetId)}
            onPreview={() => img.signedUrl && onPreview({ kind: "image", url: img.signedUrl, alt: `Scene ${scene.idx + 1} image ${i + 1}` })}
          />
        ))}
        {vo && <AssetTile label="Voiceover" entry={vo} isSelected={selected.has(vo.assetId)} onToggle={() => onToggle(vo.assetId)} />}
        {caption && (
          <AssetTile label="Captions (SRT)" entry={caption} isSelected={selected.has(caption.assetId)} onToggle={() => onToggle(caption.assetId)} />
        )}
      </div>
    </div>
  );
}

/**
 * One asset's card: a real thumbnail for image/video (click to open
 * the full-size MediaLightbox, same pattern as Scene images/videos),
 * a plain labeled tile for voiceover/captions (no useful visual
 * preview for an audio file or an SRT), a checkbox for "Download
 * selected", and its own direct download link.
 */
function AssetTile({
  label,
  entry,
  isSelected,
  onToggle,
  onPreview,
}: {
  label: string;
  entry: ExportManifestEntry;
  isSelected: boolean;
  onToggle: () => void;
  onPreview?: () => void;
}) {
  const isPreviewable = (entry.kind === "image" || entry.kind === "video") && Boolean(entry.signedUrl);

  return (
    <div
      className={`relative w-28 overflow-hidden rounded-lg border transition-colors ${
        isSelected ? "border-accent ring-1 ring-accent" : "border-border-strong"
      }`}
    >
      <label className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-background/80 backdrop-blur">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          disabled={!entry.signedUrl}
          className="h-3.5 w-3.5 accent-accent"
        />
      </label>

      <button
        type="button"
        onClick={isPreviewable ? onPreview : undefined}
        disabled={!isPreviewable}
        className={`flex aspect-square w-full items-center justify-center bg-background-raised ${isPreviewable ? "cursor-zoom-in" : ""}`}
      >
        {entry.kind === "image" && entry.signedUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.signedUrl} alt={label} className="h-full w-full object-cover" />
        )}
        {entry.kind === "video" && entry.signedUrl && (
          <video src={entry.signedUrl} muted className="h-full w-full object-cover" />
        )}
        {entry.kind === "vo" && <span className="text-2xl" aria-hidden="true">🎙️</span>}
        {entry.kind === "caption" && <span className="text-2xl" aria-hidden="true">📝</span>}
        {!entry.signedUrl && <span className="px-2 text-center text-[10px] text-foreground-muted">unavailable</span>}
      </button>

      <div className="flex items-center justify-between gap-1 bg-background px-1.5 py-1">
        <span className="truncate text-[10px] font-medium">{label}</span>
        {entry.signedUrl && (
          <a href={entry.signedUrl} download title={`Download ${label}`} className="shrink-0 text-[11px] hover:text-accent">
            ↓
          </a>
        )}
      </div>
    </div>
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
