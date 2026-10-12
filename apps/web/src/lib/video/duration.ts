/**
 * Default-duration computation for Scene videos (spec §5.7): "Default
 * duration comes from word count and whether the line is spoken."
 * Pure function so it's unit-testable without a database or model
 * registry in the loop — scene-videos-actions.ts is the only caller,
 * passing in the scene's word count, whether it speaks, and the
 * selected video model's real duration field (read from
 * model_providers.parameter_schema, never hardcoded).
 *
 * Speaking pace baseline: matches generate_scene_plan's own prompt
 * (supabase/seed_prompts.sql) exactly — "roughly 3 words per second
 * as a baseline" — rather than inventing a different number for
 * video defaults. A silent scene has no speech to pace against, so
 * it falls back to a flat short default instead (spec: "whether the
 * line is spoken").
 */

export const WORDS_PER_SECOND_SPEAKING_BASELINE = 3;

/** Flat fallback for a non-speaking scene, used only when the model's own minimum isn't available to clamp against (see defaultSceneVideoDurationS). */
export const SILENT_SCENE_FLAT_DEFAULT_S = 4;

export type VideoDurationField =
  | { kind: "enum"; options: number[] }
  | { kind: "range"; min: number; max: number };

/**
 * Reads a model's parameter_schema "duration" field (enum options
 * array, e.g. kling-v2-1-pro's ["5","10"], or integer min/max, e.g.
 * kling-3's 3-15) into the small shape defaultSceneVideoDurationS and
 * the UI slider both need. Returns null when the model has no
 * duration field at all (not every video model's schema documents
 * one, e.g. veo3-lite/quality/fast and gemini-omni-video's `duration`
 * is enum-only with no numeric range to clamp against in that case
 * either, handled the same way as "no field").
 */
export function parseVideoDurationField(
  parameterSchema: { key: string; type: string; options?: string[]; min?: number; max?: number }[]
): VideoDurationField | null {
  const field = parameterSchema.find((f) => f.key === "duration");
  if (!field) return null;

  if (field.type === "enum" && field.options?.length) {
    const numeric = field.options.map(Number).filter((n) => !Number.isNaN(n));
    if (numeric.length > 0) return { kind: "enum", options: numeric };
    return null;
  }

  if (field.type === "integer" || field.type === "number") {
    if (typeof field.min === "number" && typeof field.max === "number") {
      return { kind: "range", min: field.min, max: field.max };
    }
  }

  return null;
}

/**
 * Clamps a raw duration to whatever the model's field actually
 * allows: snaps to the nearest enum option, or clamps into
 * [min, max] for a range. Returns the raw value unchanged if there's
 * no field to clamp against (spec: "limited to the model's range" —
 * when the registry simply doesn't document a range, there's nothing
 * to clamp to, same honesty-about-unconfirmed-numbers posture as
 * clampPromptLength/REFERENCE_IMAGE_CAP).
 */
export function clampToVideoDurationField(raw: number, field: VideoDurationField | null): number {
  if (!field) return raw;

  if (field.kind === "range") {
    return Math.min(Math.max(raw, field.min), field.max);
  }

  // enum: snap to the closest allowed option rather than the first/
  // last — a scene whose natural word-count default lands between
  // two offered durations (e.g. 7s with only "5"/"10" available)
  // should round to whichever is numerically closer, not always down.
  let closest = field.options[0];
  let closestDiff = Math.abs(raw - closest);
  for (const option of field.options) {
    const diff = Math.abs(raw - option);
    if (diff < closestDiff) {
      closest = option;
      closestDiff = diff;
    }
  }
  return closest;
}

/**
 * Spec §5.7: "Default duration comes from word count and whether the
 * line is spoken." A speaking scene paces at
 * WORDS_PER_SECOND_SPEAKING_BASELINE words/sec (matching
 * generate_scene_plan's existing baseline); a silent scene has no
 * copy to pace against, so it defaults to the model's own documented
 * minimum when known, or SILENT_SCENE_FLAT_DEFAULT_S (~4s) otherwise
 * — "a shorter default" per spec, never the speaking-paced number.
 * Either way the result is clamped into whatever the model's
 * duration field actually allows.
 */
export function defaultSceneVideoDurationS(params: {
  wordCount: number;
  speaks: boolean;
  durationField: VideoDurationField | null;
}): number {
  const { wordCount, speaks, durationField } = params;

  if (speaks) {
    const paced = wordCount > 0 ? wordCount / WORDS_PER_SECOND_SPEAKING_BASELINE : SILENT_SCENE_FLAT_DEFAULT_S;
    return clampToVideoDurationField(paced, durationField);
  }

  if (durationField?.kind === "range") {
    return clampToVideoDurationField(durationField.min, durationField);
  }
  if (durationField?.kind === "enum") {
    return clampToVideoDurationField(Math.min(...durationField.options), durationField);
  }
  return SILENT_SCENE_FLAT_DEFAULT_S;
}

/** Simple whitespace word count — same shape as any other "estimate speech length from copy" caller in this codebase would use. */
export function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

/**
 * Spec §5.7's "speaking: the brief records who speaks (everyone,
 * nobody, some scenes)" resolved down to a single per-scene boolean.
 * Pure function, moved here (rather than scene-videos-actions.ts)
 * specifically because that file is a "use server" Server Actions
 * module — every export from it must be an async function, and this
 * needs to stay a plain sync function to be unit-tested directly.
 *
 * "some_scenes" defers to scenes.speaker (non-null/non-empty = this
 * scene speaks) rather than needing a separate per-scene flag, since
 * that column already exists and already means exactly this. No
 * stored `speaking` on the brief at all (an ad that predates this
 * field) defaults to "everyone" when the scene has copy — the safer
 * default for an existing ad, since treating every unconfigured ad as
 * silent would silently drop spoken-copy video generation for ads
 * nobody explicitly muted.
 */
export function resolveSceneSpeaks(
  speaking: "everyone" | "nobody" | "some_scenes" | undefined,
  scene: { copy: string; speaker: string | null }
): boolean {
  if (!scene.copy.trim()) return false; // nothing to speak regardless of the rule
  switch (speaking) {
    case "nobody":
      return false;
    case "some_scenes":
      return scene.speaker !== null && scene.speaker.trim() !== "";
    case "everyone":
    case undefined:
      return true;
  }
}
