import { z } from "zod";

/**
 * Output schema for "generate_scene_visuals" — spec §5.4 step 5
 * (Storyboard generation), which is where Hermes' old Visual
 * Director phase's job actually lands in this rebuild (confirmed via
 * a design discussion, recorded in docs/adr/002-open-decisions.md):
 * one Claude call over the whole locked scene plan writes each
 * scene's Visual description, applying shot-variety/energy-arc/
 * concretize-abstract-copy editorial judgment, plus a Product cell
 * and a shared WORLD block repeated verbatim across every scene set
 * in the same location.
 */
const SceneVisualSchema = z.object({
  scene_idx: z.number().int().describe("Matches the scene's idx in the locked scene plan"),
  visual: z.string().describe("The exact on-screen visual description for this scene"),
  route: z
    .enum(["stock-friendly", "generated", "overlay-only", "hybrid"])
    .describe("How this scene's visual should be sourced"),
  product_in_frame: z.boolean().describe("Whether the physical product is visible in this scene"),
  world_location: z
    .string()
    .nullable()
    .describe("Which WORLD block location this scene is set in, or null if it doesn't belong to one"),
});

export const SceneVisualsSchema = z.object({
  world_locations: z
    .array(
      z.object({
        name: z.string().describe("A short label for this location, e.g. 'kitchen'"),
        description: z.string().describe("One fixed sentence describing this location, repeated verbatim wherever it's used"),
      })
    )
    .max(3)
    .describe("1 to 3 locations this ad's scenes take place in"),
  scenes: z.array(SceneVisualSchema).min(1).describe("One entry per locked scene, in order"),
});

export type SceneVisuals = z.infer<typeof SceneVisualsSchema>;
