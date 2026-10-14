import { z } from "zod";

/**
 * Output schema for "suggest_scene_styles": one suggestion per scene,
 * picking a style from the catalog it was given (or null to keep the
 * ad's default look). The caller re-validates every style_id against
 * the catalog, so an invented id is dropped rather than applied.
 */
export const SuggestSceneStylesSchema = z.object({
  suggestions: z.array(
    z.object({
      scene_idx: z.number().int().describe("The scene's idx exactly as given in the input"),
      style_id: z
        .string()
        .nullable()
        .describe("id of the best style from the catalog for this scene, or null to keep the ad's default style"),
      reason: z.string().describe("One short sentence an editor can read: why this style fits this scene"),
    })
  ),
});

export type SuggestSceneStyles = z.infer<typeof SuggestSceneStylesSchema>;
