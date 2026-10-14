import { z } from "zod";

/**
 * Output schema for "plan_scene_image_from_chat": the editor asks in
 * plain words what a scene should show ("scene 3 is the CTA, write a
 * prompt for it"); this picks the scene and writes its new shot
 * description. The final image prompt is then written by the normal
 * write_image_prompt step from this visual, so style masterprompt,
 * product spec, rules and references all still apply.
 */
export const SceneImageChatSchema = z.object({
  scene_idx: z
    .number()
    .int()
    .nullable()
    .describe("idx of the scene the editor means, exactly as given; null if the request doesn't identify one"),
  visual: z
    .string()
    .describe("The new visual description for that scene: one concrete, shootable shot in that scene's style"),
  summary: z.string().describe("One short sentence telling the editor what the scene will now show"),
});

export type SceneImageChat = z.infer<typeof SceneImageChatSchema>;
