import { z } from "zod";

/**
 * Output schema for the "generate_scene_plan" task — spec §5.4 step 3:
 * split the ad's chosen script copy into scenes according to the
 * style's cutting rule (fast_cut: ~1 sentence per scene; whole_take:
 * keep full takes together), tagging each scene's hook group and an
 * estimated duration.
 */
export const ScenePlanSchema = z.object({
  scenes: z
    .array(
      z.object({
        hook_group: z
          .enum(["hook_1", "hook_2", "hook_3", "body", "cta"])
          .describe("Which structural part of the script this scene belongs to"),
        copy: z.string().describe("The exact copy text for this scene, verbatim from the script"),
        estimated_duration_s: z
          .number()
          .describe("Estimated seconds to speak this scene's copy at a natural pace"),
      })
    )
    .min(1)
    .describe("Scenes in order, covering the full script with no copy dropped or invented"),
});

export type ScenePlan = z.infer<typeof ScenePlanSchema>;
