/**
 * Staged video-prompt shortening, spec §5.7: "Respect each model's
 * prompt length limit with staged shortening: tighter rewrite, full
 * rewrite, then drop visual description the image already carries.
 * Show a note naming anything trimmed. Stop only when the core action
 * plus spoken copy cannot fit." Mirrors scene-images-actions.ts's
 * clampPromptLength honesty posture: a real, provider-documented
 * limit (e.g. kling-v2-1-pro's "Max prompt 5000 characters" from
 * supabase/seed_models.sql) is used when known; otherwise a
 * conservative default is used and flagged in code as NOT
 * provider-confirmed, same as scene-images' REFERENCE_IMAGE_CAP.
 *
 * The actual rewriting at stages 2-4 (tighter Claude rewrite, full
 * rewrite, strip-visual-description) is an LLM call
 * (write_video_prompt) — this module only owns the STAGING logic:
 * given a sequence of already-produced candidate strings, decide
 * which one is the first to fit, and report which stage that was so
 * the UI can show "trimmed down to <stage>" per spec's "note naming
 * anything trimmed." Kept here, not inline, so this decision logic is
 * unit-testable without a Claude call in the loop at all.
 */

/**
 * No model-specific prompt-length limit is documented for any video
 * model in supabase/seed_models.sql except kling-v2-1-pro's "Max
 * prompt 5000 characters" — this default is used for every other
 * video model and is explicitly NOT a provider-confirmed number
 * (same honesty standard as scene-images-actions.ts's
 * MAX_PROMPT_CHARS=900 for images). 2000 was picked as conservative
 * relative to the one real number this codebase does have (5000) —
 * video models tend to encode less textual nuance per character than
 * image models, so leaning tighter here is the safer default to
 * guess wrong in.
 */
export const DEFAULT_VIDEO_PROMPT_CHAR_LIMIT = 2000;

/** Model-specific documented limits, keyed by model_providers.endpoint — only kling-v2-1-pro's is real/confirmed; everything else falls back to DEFAULT_VIDEO_PROMPT_CHAR_LIMIT. */
export const VIDEO_PROMPT_CHAR_LIMITS: Record<string, number> = {
  "kling/v2-1-pro": 5000,
};

export function videoPromptCharLimitFor(endpoint: string): number {
  return VIDEO_PROMPT_CHAR_LIMITS[endpoint] ?? DEFAULT_VIDEO_PROMPT_CHAR_LIMIT;
}

export type ShorteningStage = "full" | "tighter_rewrite" | "full_rewrite" | "action_and_copy_only";

export const SHORTENING_STAGE_ORDER: ShorteningStage[] = [
  "full",
  "tighter_rewrite",
  "full_rewrite",
  "action_and_copy_only",
];

export type ShorteningResult =
  | { ok: true; prompt: string; stageUsed: ShorteningStage; trimmedNote: string | null }
  | { ok: false; error: string };

/**
 * Given the full-attempt prompt plus however many of the three
 * fallback candidates the caller already produced (lazily — a real
 * caller only generates a tighter rewrite if the full attempt
 * doesn't fit, etc.), picks the first candidate that fits the char
 * limit. candidates is keyed by stage so a caller that stops early
 * (e.g. the full attempt already fits) never needs to have generated
 * the later stages at all — `candidates.tighter_rewrite` etc. may be
 * omitted when unreached.
 *
 * Returns ok:false only when every stage up to and including
 * "action_and_copy_only" was tried and still doesn't fit — spec:
 * "Stop only when the core action plus spoken copy cannot fit,"
 * i.e. never silently truncate mid-sentence past that point.
 */
export function pickShortenedPrompt(
  fullPrompt: string,
  candidates: Partial<Record<Exclude<ShorteningStage, "full">, string>>,
  charLimit: number
): ShorteningResult {
  if (fullPrompt.length <= charLimit) {
    return { ok: true, prompt: fullPrompt, stageUsed: "full", trimmedNote: null };
  }

  for (const stage of SHORTENING_STAGE_ORDER) {
    if (stage === "full") continue;
    const candidate = candidates[stage];
    if (candidate === undefined) continue; // caller hadn't generated this stage — treat as "not yet tried", not "tried and failed"

    if (candidate.length <= charLimit) {
      return { ok: true, prompt: candidate, stageUsed: stage, trimmedNote: trimmedNoteFor(stage) };
    }
  }

  return {
    ok: false,
    error:
      "The video prompt is too long for this model even after dropping the visual description — try a shorter video idea or shorter scene copy.",
  };
}

function trimmedNoteFor(stage: ShorteningStage): string {
  switch (stage) {
    case "tighter_rewrite":
      return "Prompt shortened with a tighter rewrite to fit this model's length limit.";
    case "full_rewrite":
      return "Prompt rewritten from scratch to fit this model's length limit.";
    case "action_and_copy_only":
      return "Visual description dropped (the starting image already carries it) — only the core action and spoken copy were kept to fit this model's length limit.";
    case "full":
      return "";
  }
}
