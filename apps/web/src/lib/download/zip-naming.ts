/**
 * Pure file-naming logic for "Download all" (spec §5.9): "one zip
 * with files named by scene (01.mp4, 01-image-1.png, transitions
 * 01-02.mp4)". Kept pure and separate from download-zip.ts's actual
 * fetch/JSZip/browser-download code so the naming scheme itself can
 * be unit tested without a DOM, a network, or a real zip library —
 * same split this codebase already uses for duration.ts/
 * prompt-shortening.ts (pure logic) vs. their calling actions.
 *
 * Scene numbering: scenes.idx + 1, zero-padded to 2 digits — matches
 * the "Scene {scene.idx + 1}" label already shown in
 * scene-images-step.tsx/scene-videos-step.tsx exactly (confirmed by
 * reading both files directly, not assumed).
 */

export type DownloadAssetKind = "image" | "video" | "transition" | "vo" | "caption";

export type DownloadableAsset = {
  assetId: string;
  storagePath: string;
  kind: DownloadAssetKind;
  /** Scene this asset belongs to (scenes.idx, 0-based) — null only for a transition clip, which spans two scenes instead (see transitionSceneIndices). */
  sceneIdx: number | null;
  /** Only set for kind="transition": the (0-based) scene indices it bridges, e.g. scene 1 to scene 2 — see §5.9's "01-02.mp4" example. */
  transitionSceneIndices?: [number, number];
  /** 1-based ordering among same-kind images in the same scene, e.g. the 2nd image saved for scene 3 — only meaningful for kind="image" (a scene has at most one current video, per the single-current-version convention generateSceneImages/generateSceneVideo both follow). */
  imageIndexInScene?: number;
};

export type DownloadScope = "all" | "images" | "videos" | "voiceover";

/** Zero-pads a 0-based scene index into the spec's 2-digit scene number, e.g. idx=0 -> "01", idx=10 -> "11". */
export function sceneNumber(sceneIdx: number): string {
  return String(sceneIdx + 1).padStart(2, "0");
}

/**
 * The exact filename an asset gets inside the zip, per spec §5.9's
 * three worked examples: "01.mp4" (a scene's video), "01-image-1.png"
 * (numbered per scene), "01-02.mp4" (a transition between scene 1 and
 * scene 2). Returns null for an asset kind that scope excludes, or for
 * a malformed asset (e.g. an image with no sceneIdx) — callers skip
 * nulls rather than crashing on one bad row, since this always runs
 * over real, already-persisted asset rows.
 */
export function zipEntryName(asset: DownloadableAsset, extension: string): string | null {
  if (asset.kind === "video") {
    if (asset.sceneIdx === null) return null;
    return `${sceneNumber(asset.sceneIdx)}.${extension}`;
  }
  if (asset.kind === "image") {
    if (asset.sceneIdx === null) return null;
    const n = asset.imageIndexInScene ?? 1;
    return `${sceneNumber(asset.sceneIdx)}-image-${n}.${extension}`;
  }
  if (asset.kind === "vo") {
    if (asset.sceneIdx === null) return null;
    return `${sceneNumber(asset.sceneIdx)}-voiceover.${extension}`;
  }
  if (asset.kind === "caption") {
    if (asset.sceneIdx === null) return null;
    return `${sceneNumber(asset.sceneIdx)}-captions.${extension}`;
  }
  // transition
  if (!asset.transitionSceneIndices) return null;
  const [a, b] = asset.transitionSceneIndices;
  return `${sceneNumber(a)}-${sceneNumber(b)}.${extension}`;
}

/** Whether a given asset kind belongs in the zip for the editor's chosen scope ("everything, images only or videos only" — spec §5.9). Transitions count as video-shaped content, so they're included under both "all" and "videos", matching the spec's own grouping of "01.mp4" and "01-02.mp4" as the same kind of file. */
export function isIncludedInScope(kind: DownloadAssetKind, scope: DownloadScope): boolean {
  if (scope === "all") return true;
  if (scope === "images") return kind === "image";
  if (scope === "voiceover") return kind === "vo" || kind === "caption";
  return kind === "video" || kind === "transition";
}

/**
 * Resolves every asset's final zip path for one download, handling
 * the one real collision case: two images saved for the same scene
 * with the same `imageIndexInScene` (shouldn't happen if callers
 * assign indices correctly, but a defensive de-dupe keeps a
 * misassigned pair from silently overwriting one file in the zip
 * rather than crashing the whole download). A collision appends
 * "-dup2", "-dup3", etc. to every name after the first, rather than
 * silently dropping the later asset — nothing generated should
 * disappear from a download because of a naming bug (spec: "Nothing
 * generated is ever lost").
 */
export function buildZipManifest(
  assets: DownloadableAsset[],
  scope: DownloadScope,
  extensionForAsset: (asset: DownloadableAsset) => string
): { asset: DownloadableAsset; zipPath: string }[] {
  const seen = new Map<string, number>();
  const manifest: { asset: DownloadableAsset; zipPath: string }[] = [];

  for (const asset of assets) {
    if (!isIncludedInScope(asset.kind, scope)) continue;
    const name = zipEntryName(asset, extensionForAsset(asset));
    if (!name) continue;

    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    const zipPath = count === 0 ? name : withDupSuffix(name, count + 1);
    manifest.push({ asset, zipPath });
  }

  return manifest;
}

function withDupSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return `${name}-dup${n}`;
  return `${name.slice(0, dot)}-dup${n}${name.slice(dot)}`;
}

/** File extension from a storage_path, defaulting to "bin" if none is present — a defensive fallback, every real asset this app writes has a real extension (.png/.jpg/.mp4). */
export function extensionFromStoragePath(storagePath: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(storagePath);
  return match ? match[1].toLowerCase() : "bin";
}
