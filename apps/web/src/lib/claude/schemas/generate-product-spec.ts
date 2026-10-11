import { z } from "zod";

/**
 * Output schema for "generate_product_spec" — a genuine Claude VISION
 * call over a product's product_refs photos (spec §5.2: product_specs
 * is "versioned and human-editable... Photos outrank text whenever the
 * two disagree", source: 'vision'). Triggered lazily from Scene images
 * generation the first time a product with product_id set and no
 * existing product_specs row needs one — see scene-images-actions.ts's
 * ensureProductSpec().
 *
 * Kept deliberately simple for v1, per explicit scope: name/category/
 * key visual features/materials/colors is enough for the image prompt
 * writer to describe the product accurately without inventing details
 * a photo doesn't support. Not a full QA-grade spec (anatomy/physical-
 * plausibility checks are a separate, later, out-of-scope QA pass).
 */
export const GenerateProductSpecSchema = z.object({
  name: z.string().describe("The product's name as best determined from the photos and any given product facts"),
  category: z.string().describe("A short product category label, e.g. 'skincare serum' or 'running shoe'"),
  key_visual_features: z
    .array(z.string())
    .min(1)
    .describe("Distinctive visual features an image generation model needs to reproduce this exact product — shape, logo placement, cap/closure style, distinguishing marks, etc."),
  materials: z.array(z.string()).describe("Visible materials, e.g. 'brushed aluminum', 'frosted glass', 'woven cotton' — empty array if none are visually apparent"),
  colors: z.array(z.string()).min(1).describe("The product's actual colors as shown in the photos, most prominent first"),
});

export type GenerateProductSpec = z.infer<typeof GenerateProductSpecSchema>;
