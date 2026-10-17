import "server-only";
import type { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createServiceClient } from "@/lib/supabase/service";
import { getActivePrompt } from "./prompt-registry";
import { hashInput, redactedInputSummary } from "./redact";
import { PINNED_MODEL_PER_TASK, LlmCallError } from "./types";
import { assertCanSpend, estimateUsd, getAnthropicKey, mapAnthropicError, recordLlmSpend } from "./core";
import type { LlmCallParams, LlmCallResult } from "./types";

/**
 * llm.call({ task, schema, input }), spec §4 M4's own naming. One
 * entry point for every structured-output Claude call in the app:
 * resolves the org's key from Vault, reads the pinned prompt version,
 * calls client.messages.parse() for zod-validated structured output
 * (the GA structured-outputs path — see claude-api skill's TypeScript
 * tool-use.md, not a hand-rolled tool-use loop), retries exactly once
 * on a validation failure with the error appended to the prompt, and
 * records token usage into spend_events via the spend guard built in
 * M3 (record_spend_event, which also re-checks the pause/warn
 * thresholds in the same transaction as the write).
 */
export async function llmCall<Schema extends z.ZodTypeAny>(
  params: LlmCallParams<Schema>
): Promise<LlmCallResult<z.infer<Schema>>> {
  const { task, schema, input, orgId, brandId, imageUrls } = params;
  const model = params.modelOverride ?? PINNED_MODEL_PER_TASK[task];

  const supabase = createServiceClient();

  // Spend guard: refuse before spending anything, per spec §5.10
  // ("paid jobs refused when paused"), with the raw Postgres
  // exception turned into plain language (see core.ts).
  await assertCanSpend(supabase, orgId, brandId);

  const apiKey = await getAnthropicKey(supabase, orgId, brandId);
  const prompt = await getActivePrompt(task);
  const inputHash = hashInput(input);

  const client = new Anthropic({ apiKey });

  const userMessage = `${prompt.body}\n\nInput:\n${JSON.stringify(input, null, 2)}`;

  let lastValidationError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const text =
      attempt === 0
        ? userMessage
        : `${userMessage}\n\nYour previous answer failed schema validation with this error — fix it and answer again, returning only the corrected structured output:\n${lastValidationError}`;

    // Image blocks come first so the text (which may reference "the
    // images above") reads naturally after them — this is Anthropic's
    // own recommended ordering for vision requests.
    const messageContent: string | Anthropic.MessageParam["content"] = imageUrls?.length
      ? [
          ...imageUrls.map(
            (url): Anthropic.ImageBlockParam => ({
              type: "image",
              source: { type: "url", url },
            })
          ),
          { type: "text", text },
        ]
      : text;

    // messages.parse() can fail in two different ways that need
    // different handling: a plain Anthropic API failure (network,
    // auth, rate limit — not retryable by rewriting the prompt) throws
    // an APIError/APIConnectionError subclass and should surface
    // immediately via mapAnthropicError(). A response that came back
    // successfully but whose text didn't parse against the zod schema
    // throws the BASE AnthropicError class instead (confirmed by
    // reading the SDK's own parser.mjs: parseOutputFormat's catch
    // block throws `new AnthropicError(...)`, it does not return null
    // the way earlier code here assumed) — that's the "malformed
    // model answer" case spec §4 M4 wants retried once, not an API
    // failure. A first attempt at this used `response.parsed_output
    // === null` as the signal and never actually triggered on a real
    // malformed response — caught by a test that forced invalid JSON
    // through the real SDK code path, not by reading the source alone.
    let response: Awaited<ReturnType<typeof client.messages.parse>>;
    try {
      response = await client.messages.parse({
        model,
        max_tokens: 16000,
        messages: [{ role: "user", content: messageContent }],
        output_config: { format: zodOutputFormat(schema) },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
        throw mapAnthropicError(err);
      }
      // Base AnthropicError (or anything else) — treat as a schema
      // validation failure and retry once. Spend isn't recorded for
      // this attempt since the thrown error means we never got back
      // response.usage to record.
      lastValidationError = err instanceof Error ? err.message : "Response did not match the required schema.";
      continue;
    }

    const usdEstimate = estimateUsd(model, response.usage);
    await recordLlmSpend(supabase, { orgId, model, usd: usdEstimate, task });

    if (response.parsed_output === null) {
      // Defensive fallback — not currently reachable given
      // maybeParseMessage/parseMessage's behavior (a parse failure
      // throws rather than returning null), but kept in case a future
      // SDK version changes that contract back.
      lastValidationError = "Response did not match the required schema.";
      continue;
    }

    return {
      output: response.parsed_output,
      model,
      promptVersion: prompt.version,
      inputHash,
      usdEstimate,
    };
  }

  throw new LlmCallError(
    `task "${task}" failed schema validation twice (input ${redactedInputSummary(input)}, hash ${inputHash})`,
    "NEEDS_HUMAN"
  );
}
