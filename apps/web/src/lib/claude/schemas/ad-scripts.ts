import { z } from "zod";

/**
 * Output schema for the "generate_ad_scripts" task — spec-aligned
 * script-first flow: given brand/customer/product context, a target
 * length and a category tone brief, generate exactly 3 distinct
 * script variations (hook + body + CTA each). The editor picks one;
 * the manual Brief form is the fallback if none fit.
 */
export const AdScriptsSchema = z.object({
  scripts: z
    .array(
      z.object({
        hook: z.string().describe("The opening line(s) that stop the scroll"),
        body: z.string().describe("The main copy — claims, benefits, proof"),
        cta: z.string().describe("The closing call to action"),
      })
    )
    .length(3)
    .describe("Exactly three distinct script variations, varied in angle from each other"),
});

export type AdScripts = z.infer<typeof AdScriptsSchema>;
