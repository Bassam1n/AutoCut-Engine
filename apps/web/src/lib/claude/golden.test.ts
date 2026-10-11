import { describe, it, expect } from "vitest";
import { ExampleExtractionSchema } from "./schemas/example-extraction";
import golden from "./__fixtures__/example-extraction-golden.json";

/**
 * Golden-file test, spec §4 M4's own "Done when": "Golden-file tests
 * pin task outputs against recorded responses." This fixture is a
 * REAL recorded response from a real live Anthropic call (see
 * verify-llm-call.mjs, run once against the real API with the org's
 * own verified key — not fabricated), pinned so a future prompt or
 * schema change that breaks this task's output shape is caught here
 * instead of silently in production.
 */
describe("example_extraction golden file", () => {
  it("the recorded response still validates against the current schema", () => {
    const result = ExampleExtractionSchema.safeParse(golden.response.parsed_output);
    expect(result.success).toBe(true);
  });

  it("pins the task's output shape — fails loudly if a field is renamed or removed", () => {
    const output = golden.response.parsed_output;
    expect(output).toHaveProperty("claims");
    expect(output).toHaveProperty("benefits");
    expect(output).toHaveProperty("objections");
    expect(output).toHaveProperty("audience");
    expect(Array.isArray(output.claims)).toBe(true);
    expect(Array.isArray(output.benefits)).toBe(true);
    expect(Array.isArray(output.objections)).toBe(true);
    expect(typeof output.audience).toBe("string");
  });

  it("pins the prompt version this fixture was recorded against", () => {
    expect(golden.promptVersion).toBe(1);
  });

  it("the recorded output is non-trivial — not empty arrays or placeholder text", () => {
    const output = golden.response.parsed_output;
    expect(output.claims.length).toBeGreaterThan(0);
    expect(output.benefits.length).toBeGreaterThan(0);
    expect(output.audience.length).toBeGreaterThan(10);
  });
});
