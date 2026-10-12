import { z } from "zod";

/**
 * Output schema for "classify_feedback_is_question" — spec §5.8:
 * "Feedback phrased as a question is rejected before spending
 * anything, with a hint to rephrase it as a change." This is the
 * cheap/fast gate that runs structurally FIRST in every feedback
 * round (tweak, rework, and video feedback) — before claim_paid_job
 * is ever called for the real rewrite/generation work. See
 * feedback-actions.ts's runQuestionGate() for why an LLM classifier
 * was chosen over a pure heuristic (natural-language question
 * detection — "what if it was red?" vs "make it red" vs "could you
 * remove the mug?", the last of which READS like a question but is
 * actually a request — is exactly the kind of judgment a regex for
 * "?" or "could/would/can you" gets wrong often enough to matter).
 */
export const ClassifyFeedbackIsQuestionSchema = z.object({
  is_question: z
    .boolean()
    .describe(
      "True only if the feedback text is genuinely asking a question the editor wants answered (e.g. 'what if it was blue?', 'why does this look flat?') rather than describing a change to make. A polite request phrased with question words ('could you remove the mug?', 'can we make her smile?') is a CHANGE, not a question — is_question must be false for those."
    ),
  rephrase_hint: z
    .string()
    .nullable()
    .describe(
      "When is_question is true: a short, concrete suggestion for how to rephrase this as a change instead (e.g. 'Try: Make the background blue.'). Null when is_question is false."
    ),
});

export type ClassifyFeedbackIsQuestion = z.infer<typeof ClassifyFeedbackIsQuestionSchema>;
