import { z } from "zod";

/**
 * Output schema for "extract_cast" — spec §5.4 step 4's "Accepting
 * extracts the cast." Given the accepted concept and the brand's
 * existing reusable cast library (brand_cast_members), decide which
 * distinct characters this concept needs, matching each one to an
 * existing brand cast member by name/description when it clearly is
 * a returning character, or marking it new otherwise. A new
 * character gets a description detailed enough to drive a reference
 * image generation prompt (appearance, age range, styling — not
 * just a name).
 */
export const CastExtractionSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string().describe("The character's name or role label, e.g. 'Sarah' or 'the trainer'"),
        matched_brand_cast_member_id: z
          .string()
          .nullable()
          .describe("Set to an existing brand cast member's id if this is clearly that same returning character, otherwise null"),
        description: z
          .string()
          .describe("Visual description detailed enough to generate a reference image: appearance, age range, styling"),
      })
    )
    .min(1)
    .describe("Every distinct character this concept's scenes actually need"),
});

export type CastExtraction = z.infer<typeof CastExtractionSchema>;
