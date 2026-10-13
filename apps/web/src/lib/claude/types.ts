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
  // Motion preflight (spec §5.7): a vision call judging whether a
  // still image can physically perform a requested motion — locks on
  // visible people/hands/objects/product details, reasons about a
  // continuous action with a reachable end state, and when it can't,
  // has to invent a workable fallback motion plan rather than just
  // refusing. This is physical/compositional judgment under vision
  // input, the same shape and stakes as generate_scene_visuals'
  // Visual Director reasoning and write_image_prompt's editorial
  // judgment (both pinned to Opus) — not mechanical extraction like
  // generate_product_spec, which only describes what's already
  // there. Pinned to Opus for the same reason those two are.
  plan_video_motion: "claude-opus-5-5",
  // Writing the final video prompt (spec §5.7) is the video-side
  // sibling of write_image_prompt — turning Visual/copy, the motion
  // plan, speaking rules and style/rules context into one coherent
  // prompt, plus staged shortening when it doesn't fit. Same
  // editorial-judgment shape as write_image_prompt — Opus.
  write_video_prompt: "claude-opus-5-5",
  // Spec §5.8: "Feedback phrased as a question is rejected before
  // spending anything." This gate runs structurally first, before any
  // paid generation call, specifically so it has to be cheap and
  // fast — natural-language question detection ("could you remove the
  // mug?" is a request, not a question, despite the question mark) is
  // still a real classification task a pure heuristic gets wrong
  // often enough to matter, so this stays a real (if tiny) LLM call
  // rather than a regex — pinned to Haiku, the cheap/fast tier, not
  // Sonnet, since this is the one task in the app that must run
  // before any spend guard check even applies.
  classify_feedback_is_question: "claude-haiku-5-5",
  // Tweak: "a surgical edit, everything else identical, negations
  // rewritten as positive descriptions." Rework: "Claude rewrites the
  // prompt so only the named things change." Both are the same shape
  // of editorial-judgment prompt rewriting as write_image_prompt/
  // write_video_prompt (deciding how to restate a prompt so only the
  // named thing changes, including rewording negations positively) —
  // pinned to Opus for the same reason those two are, not Sonnet-tier
  // extraction.
  rewrite_tweak_prompt: "claude-opus-5-5",
  rewrite_rework_prompt: "claude-opus-5-5",
  // Rework's required diff check (spec §5.8: "a diff check confirms
  // untouched parts survived") is a structured compare-and-judge task
  // over two prompts plus the requested change — closer in shape to
  // extraction/classification (did X change, yes/no, list what) than
  // to open creative judgment, so Sonnet is the right pin, same
  // reasoning as patch_storyboard/extract_cast.
  check_rework_diff: "claude-sonnet-5-5",
  // Video feedback's "first analyses the current clip" step (spec
  // §5.8) is a vision call over a single still frame (Claude has no
  // video-input capability — see analyze-video-feedback.ts's schema
  // doc comment) describing what that frame shows/implies about the
  // clip. Reading and describing what's already in an image is
  // structural extraction, the same shape as generate_product_spec's
  // vision call, not open creative judgment — Sonnet.
  analyze_video_feedback: "claude-sonnet-5-5",
  // Spec §5.8: "When the same kind of remembered correction appears
  // at least twice, a daily job distils it into a short DO or AVOID
  // rule." Grouping free-form feedback text by underlying meaning
  // ("make her smile more" / "needs a bigger smile" / "smile isn't
  // warm enough" are the same correction) and then writing a
  // GENERALIZED rule statement from the cluster (not copying one
  // instance's wording) is real semantic/editorial judgment, the same
  // shape as write_image_prompt/rewrite_tweak_prompt's prompt-writing
  // work — pinned to Opus for the same reason those are, not Sonnet-
  // tier extraction (a plain clustering-by-similarity task would be
  // Sonnet, but generalizing wording into a durable rule statement
  // that will be injected into every future prompt for that scope is
  // higher-stakes than that).
  cluster_remembered_feedback: "claude-opus-5-5",
  // Spec §5.9: "AI names and tags images." Looking at a saved image
  // and writing a short descriptive name plus keyword tags is
  // structural extraction/description — what's visually in the frame
  // — not open creative judgment or editorial prompt-writing, the
  // same shape as generate_product_spec's vision call (also Sonnet).
  // Not Haiku: generate_product_spec (the closest sibling task,
  // reading product photos and describing what's there) was pinned to
  // Sonnet rather than Haiku for the same description-not-
  // classification reasoning, and a wrong/sloppy library name or tag
  // set actively hurts the Library's whole point (search and filter
  // depend on it), so this keeps the stronger of the two cheap tiers
  // rather than reaching for Haiku to save a fraction of a cent.
  generate_library_tags: "claude-sonnet-5-5",
  // Finding a natural sentence/clause break near a midpoint is the
  // same mechanical, rule-following shape as generate_scene_plan's
  // own cutting-rule split (which this task is a single-scene
  // re-run of) — Sonnet, not Opus.
  split_scene_copy: "claude-sonnet-5-5",
  // Rewriting one scene's visual description from its copy and the
  // same brand/concept/style/cast context generate_scene_visuals
  // uses is the same Visual Director editorial judgment, just scoped
  // to a single row instead of the whole board — same Opus pin.
  rewrite_scene_visual: "claude-opus-5-5",
  // Voiceover Studio's "Suggest voice + delivery" assist: describing a
  // tone in words and adding inline delivery/emotion tags to a short
  // line is closer to write_image_prompt/rewrite_tweak_prompt's
  // editorial prompt-writing judgment than to mechanical extraction —
  // but the scope here is much smaller (one short line, no multi-part
  // context synthesis), so Sonnet is the right pin rather than Opus.
  suggest_voiceover_delivery: "claude-sonnet-5-5",
} as const satisfies Record<string, string>;

export type Task = keyof typeof PINNED_MODEL_PER_TASK;

export type LlmCallParams<Schema extends z.ZodTypeAny> = {
  task: Task;
  schema: Schema;
  /** Serialized into the user message. Kept as a record (not a raw string) so input hashing and redaction both have real field boundaries to work with. */
  input: Record<string, unknown>;
  orgId: string;
  /** When given, resolves the brand's own Anthropic key first, falling back to the org's key if this brand has none saved — see getOrgAnthropicKey in call.ts. Omit for org-wide tasks with no single owning brand (e.g. feedback-rule distillation). */
  brandId?: string;
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
      | "NEEDS_HUMAN"
      | "SPEND_LIMIT",
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "LlmCallError";
  }
}
