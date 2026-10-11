import "server-only";
import { createHash } from "node:crypto";

/**
 * Spec §4 M4 task: "input redaction in logs." The actual input object
 * passed to llm.call() can legitimately contain brand/customer/product
 * data an org considers sensitive — this never gets logged in full.
 * What a log line gets instead is the hash (for correlating retries
 * and golden-file tests to a specific input) plus field NAMES only,
 * never values.
 */
export function hashInput(input: Record<string, unknown>): string {
  const json = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export function redactedInputSummary(input: Record<string, unknown>): string {
  return `{${Object.keys(input).sort().join(", ")}}`;
}
