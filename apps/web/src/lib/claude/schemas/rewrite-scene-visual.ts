import { z } from "zod";

/**
 * Output schema for "rewrite_scene_visual" — the per-scene sibling of
 * patch_storyboard's "Edit by chat": same free-text-instruction UX,
 * scoped to exactly one scene's visual field instead of the whole
 * board. An empty instruction means "just improve this," so the
 * schema itself can't distinguish that from a targeted ask — the
 * difference lives entirely in the prompt body the (possibly blank)
 * instruction is substituted into.
 */
export const RewriteSceneVisualSchema = z.object({
  visual: z.string().describe("The rewritten visual description for this one scene"),
});

export type RewriteSceneVisual = z.infer<typeof RewriteSceneVisualSchema>;
