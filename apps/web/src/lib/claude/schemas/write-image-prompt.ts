import { z } from "zod";

/**
 * Output schema for "write_image_prompt" — spec §5.6: "Prompt writing:
 * one Claude call turns Visual, brand context, style masterprompt,
 * active rules (5.8) and the product spec into the final image
 * prompt." Deliberately a single string field, not a structured
 * breakdown — the editor's "sticky override" (scenes.image_prompt_override)
 * replaces this exact string wholesale, so the output shape the
 * override has to match has to be just as simple.
 *
 * NOTE: this task is skipped entirely (no Claude call made) whenever
 * scenes.image_prompt_override is already set — that override text is
 * used verbatim as the final prompt. See scene-images-actions.ts's
 * resolveFinalImagePrompt().
 */
export const WriteImagePromptSchema = z.object({
  final_prompt: z
    .string()
    .describe(
      "The complete, ready-to-send image generation prompt for this scene — a single self-contained paragraph combining the scene's visual description, brand/product context, the style masterprompt's guidance, and any active DO/AVOID rules. Does not reference the input fields by name; reads as one coherent prompt."
    ),
});

export type WriteImagePrompt = z.infer<typeof WriteImagePromptSchema>;
