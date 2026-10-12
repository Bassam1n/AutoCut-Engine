import { z } from "zod";

/**
 * Output schema for "generate_library_tags" — spec §5.9: "Save any
 * image or video to the library. AI names and tags images." A real
 * Claude VISION call over the saved image, same imageUrls mechanism
 * generate_product_spec uses. Spec scopes AI naming/tagging to IMAGES
 * only ("AI names and tags images" — video is conspicuously not
 * named, unlike every other verb in that sentence), so no video
 * equivalent exists and none should be built — see
 * library-actions.ts's saveToLibrary() for where this is only called
 * when the underlying asset is an image.
 */
export const GenerateLibraryTagsSchema = z.object({
  name: z
    .string()
    .describe("A short, human-readable descriptive name for this image, e.g. 'Woman smiling on beach at sunset' — specific enough to recognize in a grid of thumbnails, under ~8 words"),
  tags: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Short lowercase keyword tags describing what's visually in the image — subject, setting, mood, notable objects. No hashtags, no punctuation, single words or short phrases."),
});

export type GenerateLibraryTags = z.infer<typeof GenerateLibraryTagsSchema>;
