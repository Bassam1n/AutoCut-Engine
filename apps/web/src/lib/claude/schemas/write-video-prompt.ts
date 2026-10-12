import { z } from "zod";

/**
 * Output schema for "write_video_prompt" — the video-side sibling of
 * write-image-prompt.ts's WriteImagePromptSchema. Turns the scene's
 * Visual/copy, the approved motion plan (plan-video-motion.ts), style/
 * rules context and the speaking rule's resolved spoken copy (or lack
 * thereof — see scene-videos-actions.ts's hard "nobody speaks" rule)
 * into one final video generation prompt.
 *
 * Deliberately single-string output, same reasoning as
 * WriteImagePromptSchema: the editor never saves a sticky override
 * for video prompts in this pass (spec §5.7 doesn't ask for one the
 * way §5.6 does for images), but keeping the shape this simple keeps
 * the staged-shortening pipeline (clampVideoPromptLength /
 * shortenVideoPrompt in scene-videos-actions.ts) working over a
 * single string at every stage.
 */
export const WriteVideoPromptSchema = z.object({
  final_prompt: z
    .string()
    .describe(
      "The complete, ready-to-send video generation prompt for this scene — one self-contained paragraph describing the continuous motion to animate (from the approved motion plan), combining any spoken copy allowed by the speaking rule, style guidance and active rules. Does not reference the input fields by name; reads as one coherent prompt a video model can act on directly."
    ),
});

export type WriteVideoPrompt = z.infer<typeof WriteVideoPromptSchema>;
