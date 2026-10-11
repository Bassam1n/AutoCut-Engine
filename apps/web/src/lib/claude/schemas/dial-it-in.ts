import { z } from "zod";

/**
 * Output schema for "generate_dial_in_questions" — spec §5.4 step 2:
 * "Claude asks up to N short questions, one at a time, with
 * tap-to-answer chips and a 'you decide' option. First about the
 * viewer ..., then about the ad ... Answers already in the brief or
 * a saved customer are not asked again." One call returns the whole
 * filtered question plan; the UI walks through it locally with no
 * further Claude calls, since chip suggestions don't need to adapt
 * to prior answers for a short, skippable, optional step.
 */
const QuestionSchema = z.object({
  id: z.string().describe("A short stable key for this question, e.g. 'viewer_age'"),
  topic: z.enum(["viewer", "ad"]).describe("Whether this is a viewer question or an ad question — viewer questions come first"),
  question: z.string().describe("The short question text shown to the editor"),
  chip_options: z
    .array(z.string())
    .describe("2-5 short tap-to-answer suggestions. 'You decide' is always available separately, not one of these."),
});

export const DialItInQuestionsSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .max(10)
    .describe("Ordered question plan, viewer topic questions before ad topic questions, already excluding anything the brief or saved customer profile already answers"),
});

export type DialItInQuestion = z.infer<typeof QuestionSchema>;
export type DialItInQuestions = z.infer<typeof DialItInQuestionsSchema>;
