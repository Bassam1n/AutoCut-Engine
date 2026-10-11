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
