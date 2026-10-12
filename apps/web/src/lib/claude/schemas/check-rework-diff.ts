import { z } from "zod";

/**
 * Output schema for "check_rework_diff" — spec §5.8: Rework "rewrites
 * the prompt so only the named things change, then a diff check
 * confirms untouched parts survived." This is a REAL verification
 * pass, not a rubber stamp: a second Claude call given the ORIGINAL
 * prompt, the REWRITTEN prompt, and the feedback text that prompted
 * the rewrite, asked to judge whether anything beyond the named
 * change actually drifted.
 *
 * Why a second Claude call rather than a text-similarity heuristic
 * (e.g. Levenshtein/diff ratio): a legitimate rework can rephrase
 * large stretches of surrounding text while preserving its MEANING
 * (e.g. tightening wording, reordering clauses) — a similarity score
 * would false-positive on exactly the kind of good rewrite this
 * feature needs to allow, and would false-negative on a rewrite that
 * keeps 95% of the characters but quietly changes one load-bearing
 * detail (e.g. swapping "red dress" for "blue dress" without touching
 * anything else nearby). Only a semantic read catches that. This is
 * explicitly allowed to fail and be shown to the editor, per spec.
 */
export const CheckReworkDiffSchema = z.object({
  passed: z
    .boolean()
    .describe(
      "True only if every part of the rewritten prompt that was NOT the subject of the requested change still describes the same thing (same setting, same other people/objects, same composition, same style) as the original prompt. False if anything unrelated to the requested change was altered, dropped, or invented."
    ),
  unrelated_changes: z
    .array(z.string())
    .describe(
      "When passed is false: a short plain-language list of the specific things that changed but shouldn't have (e.g. 'the background changed from a kitchen to a living room', 'the second person disappeared'). Empty array when passed is true."
    ),
});

export type CheckReworkDiff = z.infer<typeof CheckReworkDiffSchema>;
