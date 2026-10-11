import { z } from "zod";

/**
 * Output schema for the "example_extraction" task — a first real,
 * useful task (spec §5.4's product-URL-to-brief extraction), not a
 * disposable placeholder. Matches the prompt seeded in
 * supabase/seed_prompts.sql.
 */
export const ExampleExtractionSchema = z.object({
  claims: z.array(z.string()).describe("What the product does or promises"),
  benefits: z.array(z.string()).describe("Why a customer would want it"),
  objections: z.array(z.string()).describe("Likely skeptical-buyer objections"),
  audience: z.string().describe("Short description of the target audience"),
});

export type ExampleExtraction = z.infer<typeof ExampleExtractionSchema>;
