import { z } from "zod";

/**
 * Output schema for "generate_concepts" — spec §5.4 step 4: Claude
 * pitches three visual concept directions. Each direction is a full
 * creative pitch, not a one-line idea — title, the story being told,
 * a description of the first frame, a scene-by-scene beat list, the
 * world/setting, and standout moments worth calling out.
 */
const ConceptOptionSchema = z.object({
  title: z.string().describe("A short, memorable name for this concept direction"),
  story: z.string().describe("The narrative/premise this concept tells, in a few sentences"),
  first_frame: z.string().describe("What the viewer sees in the very first frame"),
  scene_by_scene: z
    .array(z.string())
    .describe("One beat per locked scene, in order, describing what happens visually"),
  world: z.string().describe("The setting/location(s) this concept takes place in"),
  standout_moments: z
    .array(z.string())
    .describe("1-3 specific moments that make this concept memorable"),
});

export const ConceptsSchema = z.object({
  concepts: z.array(ConceptOptionSchema).length(3).describe("Three genuinely distinct concept directions"),
});

export type Concepts = z.infer<typeof ConceptsSchema>;
export type ConceptOption = z.infer<typeof ConceptOptionSchema>;
