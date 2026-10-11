import type { z } from "zod";

/**
 * Spec §4/§5 "prompt registry with versions, one pinned model per
 * task" — the pin is a code-level decision (which model a task runs
 * on is a stability/cost choice, not something tuned per request), so
 * it lives here as a TypeScript map rather than a database column.
 * The prompt BODY still comes from prompt_versions (platform-wide,
 * versioned, service-role-write-only) — this map only pins the model.
 */
export const PINNED_MODEL_PER_TASK = {
  // Placeholder entries — real tasks land as M5+ brief/storyboard/
  // concept work is built. claude-sonnet-5-5 per claude-api skill
  // defaults: Opus is the default model generally, but structured
  // extraction/classification-shaped tasks (what every M4 task is)
  // don't need Opus-tier reasoning — Sonnet is the right pin until a
  // specific task is measured to need more.
  example_extraction: "claude-sonnet-5-5",
  // Copywriting with real creative variance across 3 angles benefits
  // from the stronger model more than pure extraction does — pinned
  // to Opus rather than Sonnet.
  generate_ad_scripts: "claude-opus-5-5",
  // Splitting copy into scenes by a cutting rule is a mechanical,
  // rule-following task much closer to extraction/classification
  // than to open creative writing — Sonnet is the right pin.
  generate_scene_plan: "claude-sonnet-5-5",
  // Pitching 3 genuinely distinct creative concepts is open creative
  // work, same tier as script generation — pinned to Opus.
  generate_concepts: "claude-opus-5-5",
  // Identifying/matching characters is closer to extraction than
  // creative writing — Sonnet is the right pin.
  extract_cast: "claude-sonnet-5-5",
  // Visual Director's editorial judgment (shot variety, energy arc,
  // concretizing abstract copy) is a real creative-reasoning task,
  // not mechanical extraction — pinned to Opus like concepts/scripts.
  generate_scene_visuals: "claude-opus-5-5",
  // Turning a plain-language edit instruction into a precise,
  // narrowly-scoped patch is closer to structured extraction than
  // open creative writing — Sonnet is the right pin, and keeps chat
  // edits fast and cheap for something the editor may do repeatedly.
  patch_storyboard: "claude-sonnet-5-5",
  // Deciding which short clarifying questions are still worth asking
  // (and filtering out ones already answered) is closer to
  // extraction/classification than creative writing — Sonnet.
  generate_dial_in_questions: "claude-sonnet-5-5",
  // Turning a scene's Visual plus brand/product context, style
  // masterprompt and active rules into the single final image prompt
  // is editorial/creative judgment — deciding how to phrase and
  // emphasize a prompt so the image model actually produces the right
  // shot — much closer to generate_scene_visuals' Visual Director
  // judgment than to mechanical extraction, so it gets the same Opus
  // pin. (Skipped entirely when scenes.image_prompt_override is set —
  // see write-image-prompt.ts.)
  write_image_prompt: "claude-opus-5-5",
  // Reading a product's reference photos and naming its category,
  // materials, colors and visual features is structural extraction
  // from images, not open creative judgment — same shape as
  // extract_cast, just with vision input instead of text. Sonnet.
  generate_product_spec: "claude-sonnet-5-5",
} as const satisfies Record<string, string>;

export type Task = keyof typeof PINNED_MODEL_PER_TASK;

export type LlmCallParams<Schema extends z.ZodTypeAny> = {
  task: Task;
  schema: Schema;
  /** Serialized into the user message. Kept as a record (not a raw string) so input hashing and redaction both have real field boundaries to work with. */
  input: Record<string, unknown>;
  orgId: string;
  /** Overrides the task's pinned model — only for testing against a cheaper model; production code should rely on the pin. */
  modelOverride?: string;
  /** Publicly-fetchable image URLs (e.g. Supabase Storage public URLs) attached as vision content blocks alongside the text input — for tasks that need to look at images (e.g. product-spec generation from product photos). */
  imageUrls?: string[];
};

export type LlmCallResult<T> = {
  output: T;
  model: string;
  promptVersion: number;
  inputHash: string;
  usdEstimate: number;
};

export class LlmCallError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "KEY_INVALID"
      | "KEY_NO_CREDIT"
      | "RATE_LIMIT"
      | "TIMEOUT"
      | "PROVIDER_ERROR"
      | "VALIDATION"
      | "NEEDS_HUMAN",
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "LlmCallError";
  }
}
