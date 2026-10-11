import { z } from "zod";

/**
 * Output schema for "patch_storyboard" — spec §5.5 "Edit by chat":
 * a chat box patches the board in place. Claude returns a patch (list
 * of cell edits, added rows, product switch), validated against this
 * schema, never a regenerated board. Existing images/videos stay —
 * this task never produces a kind: "add" row with image content, only
 * text fields a human can write (copy/visual/product), consistent
 * with "Images are never regenerated automatically after a patch."
 */
const CellEditSchema = z.object({
  kind: z.literal("edit"),
  scene_idx: z.number().int().describe("Which existing scene to edit, by its current idx"),
  copy: z.string().nullable().describe("New copy text, or null to leave unchanged"),
  visual: z.string().nullable().describe("New visual description, or null to leave unchanged"),
  product_in_frame: z.boolean().nullable().describe("New product-in-frame flag, or null to leave unchanged"),
});

const AddRowSchema = z.object({
  kind: z.literal("add"),
  after_scene_idx: z.number().int().describe("Insert the new scene immediately after this existing idx"),
  hook_group: z.enum(["hook_1", "hook_2", "hook_3", "body", "cta"]),
  copy: z.string(),
  visual: z.string(),
  product_in_frame: z.boolean(),
});

const DeleteRowSchema = z.object({
  kind: z.literal("delete"),
  scene_idx: z.number().int(),
});

export const StoryboardPatchSchema = z.object({
  summary: z.string().describe("One short sentence describing what this patch changed, shown to the editor"),
  operations: z
    .array(z.discriminatedUnion("kind", [CellEditSchema, AddRowSchema, DeleteRowSchema]))
    .describe("Ordered list of operations to apply to the storyboard. Only touch what the editor's instruction actually asked for."),
});

export type StoryboardPatch = z.infer<typeof StoryboardPatchSchema>;
export type StoryboardPatchOperation = StoryboardPatch["operations"][number];
