import { z } from "zod";

/**
 * Output schema for "rewrite_tweak_prompt" / "rewrite_rework_prompt" —
 * spec §5.8: Tweak is "a surgical edit, everything else identical,
 * negations rewritten as positive descriptions"; Rework is "Claude
 * rewrites the prompt so only the named things change" (then a
 * separate diff check verifies it — see check-rework-diff.ts). Both
 * modes share this exact output shape; which task/prompt body runs
 * is chosen by the caller (feedback-actions.ts) based on mode, not by
 * a field in this schema.
 *
 * request_type is classified in THIS SAME call rather than a separate
 * paid call — spec's placement/remove-frame detection ("Placement and
 * 'remove the frame' requests rebuild without feeding the old image
 * back, and say so") needs a classification step, and reusing this
 * call's existing judgment (it already has to understand what the
 * feedback is asking for in order to rewrite the prompt) avoids a
 * second Claude call just to classify the same text a second time.
 */
export const RewriteFeedbackPromptSchema = z.object({
  rewritten_prompt: z
    .string()
    .describe(
      "The full rewritten prompt — every part of the original prompt preserved verbatim except the specific change the feedback asked for. Any negation in the feedback ('remove the mug', 'she shouldn't be frowning') is rewritten as a positive description of what IS there instead (e.g. restructure the scene description to simply not mention a mug; describe her as smiling or neutral directly) — never phrased as an instruction to a downstream model to omit or avoid something."
    ),
  request_type: z
    .enum(["surgical", "placement_or_removal"])
    .describe(
      "'surgical' for an ordinary tweak/rework that changes a detail without disturbing the shot's composition (color, expression, clothing, small added/removed object that doesn't restructure the frame). 'placement_or_removal' when the feedback asks to reposition, recompose, or remove something structural from the shot (move the subject, change camera angle/framing, remove the backdrop/frame/setting itself) — this request type means the new image must NOT be built from the old one as a reference."
    ),
  change_summary: z
    .string()
    .describe("One short plain-language sentence naming exactly what changed, shown to the editor."),
});

export type RewriteFeedbackPrompt = z.infer<typeof RewriteFeedbackPromptSchema>;
