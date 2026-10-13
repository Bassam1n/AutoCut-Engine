import { z } from "zod";

/**
 * Output schema for "split_scene_copy" — scene-plan step's Split
 * button (spec §5.5). Finds a natural break point near the midpoint
 * of a single scene's copy (end of a sentence or clause, never
 * mid-word) and returns the two resulting halves verbatim.
 */
export const SplitSceneCopySchema = z.object({
  first: z.string().describe("The first half of the copy, verbatim from the input — exact words, spacing and punctuation preserved, nothing added or dropped"),
  second: z.string().describe("The second half of the copy, verbatim from the input, picking up exactly where 'first' leaves off"),
});

export type SplitSceneCopy = z.infer<typeof SplitSceneCopySchema>;
