import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { PINNED_MODEL_PER_TASK } from "@/lib/claude/types";
import { EditPlan, Review } from "./plan-schema";

/**
 * Contract test: each structured-output schema Auto-edit sends must be
 * accepted by the API. A z.record that compiles to "no keys allowed" or
 * a grammar over the size limit ("Compiled grammar is too large") only
 * shows up as a 400 from the real API, so this makes one tiny call per
 * schema. Skipped without a key (CI has none); run it with
 * AUTO_EDIT_CONTRACT_ANTHROPIC_KEY set after changing plan-schema.ts.
 */
const key = process.env.AUTO_EDIT_CONTRACT_ANTHROPIC_KEY;

describe.skipIf(!key)("Auto-edit structured-output schemas against the API", () => {
  const client = new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com" });

  it.each([
    ["EditPlan", EditPlan],
    ["Review", Review],
  ])("%s compiles", async (_name, schema) => {
    const res = await client.beta.messages.create({
      model: PINNED_MODEL_PER_TASK.auto_edit_plan,
      max_tokens: 64,
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: "Reply with the smallest valid value." }],
    });
    expect(res.id).toMatch(/^msg_/);
  }, 120_000);
});
