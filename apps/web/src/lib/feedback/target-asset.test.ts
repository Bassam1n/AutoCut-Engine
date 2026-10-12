import { describe, it, expect } from "vitest";
import { pickLatestAssetOfKind, pickVideoFeedbackStillAsset } from "./target-asset";

describe("pickLatestAssetOfKind", () => {
  it("returns null when no asset of that kind exists", () => {
    expect(pickLatestAssetOfKind([{ id: "a", kind: "video", version: 1 }], "image")).toBeNull();
  });

  it("picks the highest version among matching-kind assets", () => {
    const assets = [
      { id: "a", kind: "image", version: 1 },
      { id: "b", kind: "image", version: 3 },
      { id: "c", kind: "image", version: 2 },
      { id: "d", kind: "video", version: 9 },
    ];
    const result = pickLatestAssetOfKind(assets, "image");
    expect(result?.id).toBe("b");
  });
});

describe("pickVideoFeedbackStillAsset", () => {
  it("prefers a last_frame asset over the source image when one exists", () => {
    const assets = [
      { id: "img", kind: "image", version: 1 },
      { id: "lf", kind: "last_frame", version: 1 },
    ];
    const result = pickVideoFeedbackStillAsset(assets);
    expect(result).toEqual({ asset: assets[1], isLastFrame: true });
  });

  it("falls back to the latest source image when no last_frame asset exists — the honest substitute since no provider path writes last_frame yet", () => {
    const assets = [
      { id: "img1", kind: "image", version: 1 },
      { id: "img2", kind: "image", version: 2 },
      { id: "vid", kind: "video", version: 1 },
    ];
    const result = pickVideoFeedbackStillAsset(assets);
    expect(result).toEqual({ asset: assets[1], isLastFrame: false });
  });

  it("returns null when neither a last_frame nor an image asset exists", () => {
    const assets = [{ id: "vid", kind: "video", version: 1 }];
    expect(pickVideoFeedbackStillAsset(assets)).toBeNull();
  });
});
