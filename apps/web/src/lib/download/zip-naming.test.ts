import { describe, it, expect } from "vitest";
import {
  sceneNumber,
  zipEntryName,
  isIncludedInScope,
  buildZipManifest,
  extensionFromStoragePath,
  type DownloadableAsset,
} from "./zip-naming";

describe("sceneNumber", () => {
  it("zero-pads a 0-based scene index to 2 digits", () => {
    expect(sceneNumber(0)).toBe("01");
    expect(sceneNumber(8)).toBe("09");
  });

  it("does not truncate a 2-digit scene number", () => {
    expect(sceneNumber(10)).toBe("11");
    expect(sceneNumber(98)).toBe("99");
  });
});

describe("zipEntryName", () => {
  it('names a scene video "NN.mp4" per spec §5.9\'s own example', () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x/video.mp4", kind: "video", sceneIdx: 0 };
    expect(zipEntryName(asset, "mp4")).toBe("01.mp4");
  });

  it('names a scene image "NN-image-K.ext" per spec §5.9\'s own example', () => {
    const asset: DownloadableAsset = {
      assetId: "a",
      storagePath: "x/img.png",
      kind: "image",
      sceneIdx: 0,
      imageIndexInScene: 1,
    };
    expect(zipEntryName(asset, "png")).toBe("01-image-1.png");
  });

  it("defaults imageIndexInScene to 1 when not given", () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x/img.png", kind: "image", sceneIdx: 2 };
    expect(zipEntryName(asset, "png")).toBe("03-image-1.png");
  });

  it("numbers a second image for the same scene distinctly", () => {
    const asset: DownloadableAsset = {
      assetId: "a",
      storagePath: "x/img.png",
      kind: "image",
      sceneIdx: 2,
      imageIndexInScene: 2,
    };
    expect(zipEntryName(asset, "png")).toBe("03-image-2.png");
  });

  it('names a transition "NN-MM.mp4" per spec §5.9\'s own example (01-02.mp4)', () => {
    const asset: DownloadableAsset = {
      assetId: "a",
      storagePath: "x/trans.mp4",
      kind: "transition",
      sceneIdx: null,
      transitionSceneIndices: [0, 1],
    };
    expect(zipEntryName(asset, "mp4")).toBe("01-02.mp4");
  });

  it('names a scene voiceover clip "NN-voiceover.ext"', () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x/vo.mp3", kind: "vo", sceneIdx: 1 };
    expect(zipEntryName(asset, "mp3")).toBe("02-voiceover.mp3");
  });

  it('names a scene caption/SRT "NN-captions.ext"', () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x/cap.srt", kind: "caption", sceneIdx: 1 };
    expect(zipEntryName(asset, "srt")).toBe("02-captions.srt");
  });

  it("returns null for a video/image with no sceneIdx rather than inventing a name", () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x", kind: "video", sceneIdx: null };
    expect(zipEntryName(asset, "mp4")).toBeNull();
  });

  it("returns null for a transition missing its bridged scene indices", () => {
    const asset: DownloadableAsset = { assetId: "a", storagePath: "x", kind: "transition", sceneIdx: null };
    expect(zipEntryName(asset, "mp4")).toBeNull();
  });
});

describe("isIncludedInScope", () => {
  it('"all" includes every kind', () => {
    expect(isIncludedInScope("image", "all")).toBe(true);
    expect(isIncludedInScope("video", "all")).toBe(true);
    expect(isIncludedInScope("transition", "all")).toBe(true);
  });

  it('"images" includes only images', () => {
    expect(isIncludedInScope("image", "images")).toBe(true);
    expect(isIncludedInScope("video", "images")).toBe(false);
    expect(isIncludedInScope("transition", "images")).toBe(false);
  });

  it('"videos" includes videos AND transitions (both video-shaped, per spec\'s own grouping of 01.mp4/01-02.mp4)', () => {
    expect(isIncludedInScope("video", "videos")).toBe(true);
    expect(isIncludedInScope("transition", "videos")).toBe(true);
    expect(isIncludedInScope("image", "videos")).toBe(false);
  });

  it('"voiceover" includes only vo and caption kinds', () => {
    expect(isIncludedInScope("vo", "voiceover")).toBe(true);
    expect(isIncludedInScope("caption", "voiceover")).toBe(true);
    expect(isIncludedInScope("video", "voiceover")).toBe(false);
    expect(isIncludedInScope("image", "voiceover")).toBe(false);
  });
});

describe("buildZipManifest", () => {
  const extAsPng = () => "png";

  it("builds one manifest entry per included asset, skipping excluded-scope assets", () => {
    const assets: DownloadableAsset[] = [
      { assetId: "img", storagePath: "x", kind: "image", sceneIdx: 0 },
      { assetId: "vid", storagePath: "y", kind: "video", sceneIdx: 0 },
    ];
    const manifest = buildZipManifest(assets, "images", extAsPng);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].asset.assetId).toBe("img");
    expect(manifest[0].zipPath).toBe("01-image-1.png");
  });

  it("de-dupes a genuine filename collision instead of silently dropping an asset (spec: nothing generated is ever lost)", () => {
    const assets: DownloadableAsset[] = [
      { assetId: "img1", storagePath: "x", kind: "image", sceneIdx: 0, imageIndexInScene: 1 },
      { assetId: "img2", storagePath: "y", kind: "image", sceneIdx: 0, imageIndexInScene: 1 },
    ];
    const manifest = buildZipManifest(assets, "all", extAsPng);
    expect(manifest).toHaveLength(2);
    expect(manifest[0].zipPath).toBe("01-image-1.png");
    expect(manifest[1].zipPath).toBe("01-image-1-dup2.png");
  });

  it("skips an asset that resolves to no name (e.g. malformed transition) without throwing", () => {
    const assets: DownloadableAsset[] = [{ assetId: "bad", storagePath: "x", kind: "transition", sceneIdx: null }];
    const manifest = buildZipManifest(assets, "all", extAsPng);
    expect(manifest).toHaveLength(0);
  });

  it("uses the per-asset extension resolver, not a fixed extension", () => {
    const assets: DownloadableAsset[] = [{ assetId: "vid", storagePath: "y.mp4", kind: "video", sceneIdx: 0 }];
    const manifest = buildZipManifest(assets, "all", (a) => extensionFromStoragePath(a.storagePath));
    expect(manifest[0].zipPath).toBe("01.mp4");
  });
});

describe("extensionFromStoragePath", () => {
  it("extracts the extension", () => {
    expect(extensionFromStoragePath("org/ad/scene/image.png")).toBe("png");
    expect(extensionFromStoragePath("org/ad/scene/video.MP4")).toBe("mp4");
  });

  it("defaults to bin when there's no extension", () => {
    expect(extensionFromStoragePath("org/ad/scene/noext")).toBe("bin");
  });
});
