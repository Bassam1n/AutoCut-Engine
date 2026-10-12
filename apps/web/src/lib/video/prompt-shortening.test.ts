import { describe, it, expect } from "vitest";
import {
  pickShortenedPrompt,
  videoPromptCharLimitFor,
  DEFAULT_VIDEO_PROMPT_CHAR_LIMIT,
  VIDEO_PROMPT_CHAR_LIMITS,
} from "./prompt-shortening";

describe("videoPromptCharLimitFor", () => {
  it("uses kling-v2-1-pro's real documented limit (5000 chars)", () => {
    expect(videoPromptCharLimitFor("kling/v2-1-pro")).toBe(5000);
    expect(videoPromptCharLimitFor("kling/v2-1-pro")).toBe(VIDEO_PROMPT_CHAR_LIMITS["kling/v2-1-pro"]);
  });

  it("falls back to the conservative, non-provider-confirmed default for every other model", () => {
    expect(videoPromptCharLimitFor("kling-3.0/video")).toBe(DEFAULT_VIDEO_PROMPT_CHAR_LIMIT);
    expect(videoPromptCharLimitFor("veo3_lite")).toBe(DEFAULT_VIDEO_PROMPT_CHAR_LIMIT);
  });
});

describe("pickShortenedPrompt", () => {
  const charLimit = 100;

  it("stage 1: returns the full prompt unchanged when it already fits", () => {
    const full = "a short prompt";
    const result = pickShortenedPrompt(full, {}, charLimit);
    expect(result).toEqual({ ok: true, prompt: full, stageUsed: "full", trimmedNote: null });
  });

  it("stage 2: picks the tighter rewrite when the full prompt doesn't fit but the tighter one does", () => {
    const full = "x".repeat(150);
    const tighter = "y".repeat(80);
    const result = pickShortenedPrompt(full, { tighter_rewrite: tighter }, charLimit);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toBe(tighter);
      expect(result.stageUsed).toBe("tighter_rewrite");
      expect(result.trimmedNote).toMatch(/tighter rewrite/i);
    }
  });

  it("stage 3: skips a too-long tighter rewrite and picks the full rewrite", () => {
    const full = "x".repeat(150);
    const tighter = "y".repeat(120); // still too long
    const fullRewrite = "z".repeat(90);
    const result = pickShortenedPrompt(full, { tighter_rewrite: tighter, full_rewrite: fullRewrite }, charLimit);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toBe(fullRewrite);
      expect(result.stageUsed).toBe("full_rewrite");
    }
  });

  it("stage 4: falls through to action-and-copy-only when every earlier stage is too long", () => {
    const full = "x".repeat(150);
    const tighter = "y".repeat(120);
    const fullRewrite = "z".repeat(110);
    const actionOnly = "w".repeat(50);
    const result = pickShortenedPrompt(
      full,
      { tighter_rewrite: tighter, full_rewrite: fullRewrite, action_and_copy_only: actionOnly },
      charLimit
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toBe(actionOnly);
      expect(result.stageUsed).toBe("action_and_copy_only");
      expect(result.trimmedNote).toMatch(/visual description dropped/i);
    }
  });

  it("stops with a clear error when even stage 4 doesn't fit — never silently truncates", () => {
    const full = "x".repeat(150);
    const actionOnly = "w".repeat(110); // still over the limit
    const result = pickShortenedPrompt(full, { action_and_copy_only: actionOnly }, charLimit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too long/i);
    }
  });

  it("treats an omitted stage as not-yet-tried and keeps looking, rather than failing early", () => {
    const full = "x".repeat(150);
    const fullRewrite = "z".repeat(60);
    // tighter_rewrite omitted entirely (caller never generated it)
    const result = pickShortenedPrompt(full, { full_rewrite: fullRewrite }, charLimit);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stageUsed).toBe("full_rewrite");
    }
  });
});
