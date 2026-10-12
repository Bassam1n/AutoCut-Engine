import "server-only";
import type { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createServiceClient } from "@/lib/supabase/service";
import { getActivePrompt } from "./prompt-registry";
import { hashInput, redactedInputSummary } from "./redact";
import { PINNED_MODEL_PER_TASK, LlmCallError } from "./types";
import type { LlmCallParams, LlmCallResult } from "./types";
import { spendLimitMessage } from "@/lib/spend-limit-message";

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
  const { task, schema, input, orgId, imageUrls } = params;
  const model = params.modelOverride ?? PINNED_MODEL_PER_TASK[task];

  const supabase = createServiceClient();

  // Spend guard: refuse before spending anything, per spec §5.10
  // ("paid jobs refused when paused"). claim_paid_job() raises a raw
  // Postgres exception shaped like "org_paused: Spend guard: 24h
  // spend $X crossed the $Y stop threshold" — plain-language-ify it
  // here rather than letting that string reach an end user with no
  // context for what "org_paused" means (spec §5.10's error
  // vocabulary names SPEND_LIMIT as the code for exactly this case).
  const { error: claimError } = await supabase.rpc("claim_paid_job", {
    target_org_id: orgId,
  });
  if (claimError) {
    throw new LlmCallError(spendLimitMessage(claimError.message), "SPEND_LIMIT", claimError);
  }

  const apiKey = await getOrgAnthropicKey(orgId);
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
    await recordSpend(supabase, orgId, model, usdEstimate, task);

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

async function getOrgAnthropicKey(orgId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_org_secret_value", {
    target_org_id: orgId,
    target_provider: "anthropic",
  });

  if (error || !data) {
    throw new LlmCallError(
      error?.message ?? "no Anthropic key saved for this org",
      "KEY_INVALID",
      error
    );
  }

  return data;
}

async function recordSpend(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  model: string,
  usdEstimate: number,
  task: string
): Promise<void> {
  const { error } = await supabase.rpc("record_spend_event", {
    target_org_id: orgId,
    target_ad_id: null,
    target_provider: "anthropic",
    target_model: model,
    target_usd_est: usdEstimate,
    target_kind: `llm:${task}`,
  });
  if (error) {
    // Spend recording failing should never silently swallow a
    // successful generation — but it also shouldn't be allowed to
    // throw away real output over a logging-path failure. Re-thrown
    // as PROVIDER_ERROR so the caller/job runner sees it and can
    // decide (M9), rather than failing silently here.
    throw new LlmCallError(`record_spend_event failed: ${error.message}`, "PROVIDER_ERROR", error);
  }
}

/** claude-api skill's current pricing table (cached 2026-10-06). Sonnet 5.5: $2/$10 per MTok. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

function estimateUsd(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0; // unpriced model — price_table (spec §4) is the real source of truth once populated for LLM tasks too
  return (usage.input_tokens / 1_000_000) * price.input + (usage.output_tokens / 1_000_000) * price.output;
}

function mapAnthropicError(err: unknown): LlmCallError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new LlmCallError("Anthropic key is invalid.", "KEY_INVALID", err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmCallError("Anthropic rate limit hit.", "RATE_LIMIT", err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmCallError("Could not reach Anthropic.", "TIMEOUT", err);
  }
  if (err instanceof Anthropic.APIError) {
    // billing_error (HTTP 402, out of credit) has no dedicated typed
    // class in the SDK — confirmed from the claude-api skill's own
    // error-codes reference, which lists a distinct exception class
    // for every other 4xx/5xx but not 402. Check status/.type instead.
    if (err.status === 402) {
      return new LlmCallError("Anthropic key has no credit.", "KEY_NO_CREDIT", err);
    }
    return new LlmCallError(err.message, "PROVIDER_ERROR", err);
  }
  return new LlmCallError(
    err instanceof Error ? err.message : "unknown Anthropic client error",
    "PROVIDER_ERROR",
    err
  );
}
