import { describe, it, expect } from "vitest";
import {
  parseVideoDurationField,
  clampToVideoDurationField,
  defaultSceneVideoDurationS,
  countWords,
  resolveSceneSpeaks,
  WORDS_PER_SECOND_SPEAKING_BASELINE,
  SILENT_SCENE_FLAT_DEFAULT_S,
} from "./duration";

describe("parseVideoDurationField", () => {
  it("parses an enum duration field's options into numbers (kling-v2-1-pro shape)", () => {
    const field = parseVideoDurationField([
      { key: "duration", type: "enum", options: ["5", "10"] },
    ]);
    expect(field).toEqual({ kind: "enum", options: [5, 10] });
  });

  it("parses an integer min/max duration field (kling-3 shape)", () => {
    const field = parseVideoDurationField([{ key: "duration", type: "integer", min: 3, max: 15 }]);
    expect(field).toEqual({ kind: "range", min: 3, max: 15 });
  });

  it("returns null when no duration field exists", () => {
    const field = parseVideoDurationField([{ key: "aspect_ratio", type: "enum", options: ["16:9"] }]);
    expect(field).toBeNull();
  });

  it("returns null for an integer field missing min/max", () => {
    const field = parseVideoDurationField([{ key: "duration", type: "integer" }]);
    expect(field).toBeNull();
  });
});

describe("clampToVideoDurationField", () => {
  it("clamps into [min, max] for a range field", () => {
    const field = { kind: "range" as const, min: 4, max: 15 };
    expect(clampToVideoDurationField(2, field)).toBe(4);
    expect(clampToVideoDurationField(20, field)).toBe(15);
    expect(clampToVideoDurationField(8, field)).toBe(8);
  });

  it("snaps to the nearest enum option", () => {
    const field = { kind: "enum" as const, options: [5, 10] };
    expect(clampToVideoDurationField(7, field)).toBe(5);
    expect(clampToVideoDurationField(8, field)).toBe(10);
  });

  it("returns the raw value unchanged when there's no field to clamp against", () => {
    expect(clampToVideoDurationField(42, null)).toBe(42);
  });
});

describe("defaultSceneVideoDurationS", () => {
  it("paces a speaking scene at the 3 words/sec baseline, matching generate_scene_plan's own prompt", () => {
    const durationField = { kind: "range" as const, min: 3, max: 15 };
    const wordCount = 9; // 9 / 3 = 3s
    const result = defaultSceneVideoDurationS({ wordCount, speaks: true, durationField });
    expect(result).toBe(wordCount / WORDS_PER_SECOND_SPEAKING_BASELINE);
  });

  it("clamps a speaking scene's paced duration into the model's range", () => {
    const durationField = { kind: "range" as const, min: 4, max: 8 };
    const result = defaultSceneVideoDurationS({ wordCount: 60, speaks: true, durationField }); // 20s paced
    expect(result).toBe(8);
  });

  it("falls back to the model's minimum for a silent scene with a range field", () => {
    const durationField = { kind: "range" as const, min: 4, max: 15 };
    const result = defaultSceneVideoDurationS({ wordCount: 30, speaks: false, durationField });
    expect(result).toBe(4);
  });

  it("falls back to the smallest enum option for a silent scene with an enum field", () => {
    const durationField = { kind: "enum" as const, options: [5, 10] };
    const result = defaultSceneVideoDurationS({ wordCount: 30, speaks: false, durationField });
    expect(result).toBe(5);
  });

  it("falls back to the flat ~4s default for a silent scene when the model documents no range at all", () => {
    const result = defaultSceneVideoDurationS({ wordCount: 30, speaks: false, durationField: null });
    expect(result).toBe(SILENT_SCENE_FLAT_DEFAULT_S);
  });

  it("falls back to the flat default for a speaking scene with zero words and no duration field", () => {
    const result = defaultSceneVideoDurationS({ wordCount: 0, speaks: true, durationField: null });
    expect(result).toBe(SILENT_SCENE_FLAT_DEFAULT_S);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("the quick brown fox")).toBe(4);
  });

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("resolveSceneSpeaks", () => {
  it("returns false for a scene with no copy regardless of the rule", () => {
    expect(resolveSceneSpeaks("everyone", { copy: "", speaker: "Sarah" })).toBe(false);
    expect(resolveSceneSpeaks("everyone", { copy: "   ", speaker: "Sarah" })).toBe(false);
  });

  it('"nobody" is always false when the scene has copy — the hard spec rule', () => {
    expect(resolveSceneSpeaks("nobody", { copy: "hello there", speaker: "Sarah" })).toBe(false);
    expect(resolveSceneSpeaks("nobody", { copy: "hello there", speaker: null })).toBe(false);
  });

  it('"everyone" is true for any scene with copy', () => {
    expect(resolveSceneSpeaks("everyone", { copy: "hello there", speaker: null })).toBe(true);
  });

  it('"some_scenes" defers to scenes.speaker — non-null/non-empty means this scene speaks', () => {
    expect(resolveSceneSpeaks("some_scenes", { copy: "hello there", speaker: "Sarah" })).toBe(true);
    expect(resolveSceneSpeaks("some_scenes", { copy: "hello there", speaker: null })).toBe(false);
    expect(resolveSceneSpeaks("some_scenes", { copy: "hello there", speaker: "" })).toBe(false);
  });

  it('defaults to "everyone" behavior when brief.speaking was never set (ad predates this field)', () => {
    expect(resolveSceneSpeaks(undefined, { copy: "hello there", speaker: null })).toBe(true);
  });
});
