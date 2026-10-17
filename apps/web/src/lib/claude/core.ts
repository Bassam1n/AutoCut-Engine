import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { LlmCallError, type Task } from "./types";

/**
 * The steps every Claude call in the app shares, without the
 * "server-only" guard, so Trigger.dev tasks (which can't resolve that
 * package) use the same code as llmCall() in call.ts: spend guard, the
 * brand's or org's Anthropic key from Vault, the active prompt from
 * prompt_versions, pricing and record_spend_event. Each takes the
 * service-role client from its caller.
 */

/**
 * Refuses before anything is spent (spec §5.10): claim_paid_job()
 * raises "org_paused: ..." and friends, assert_brand_active()
 * "brand_archived: ...". Both are turned into plain language.
 */
export async function assertCanSpend(supabase: SupabaseClient, orgId: string, brandId?: string): Promise<void> {
  const claimError =
    (await supabase.rpc("claim_paid_job", { target_org_id: orgId })).error ??
    (brandId ? (await supabase.rpc("assert_brand_active", { target_org_id: orgId, target_brand_id: brandId })).error : null);
  if (claimError) {
    throw new LlmCallError(spendLimitMessage(claimError.message), "SPEND_LIMIT", claimError);
  }
}

/**
 * brandId present: the brand's own Anthropic key, falling back to the
 * org's (get_brand_secret_value's own fallback, migration 51/55).
 * brandId absent: the org's key only.
 */
export async function getAnthropicKey(supabase: SupabaseClient, orgId: string, brandId?: string): Promise<string> {
  const { data, error } = brandId
    ? await supabase.rpc("get_brand_secret_value", { target_org_id: orgId, target_brand_id: brandId, target_provider: "anthropic" })
    : await supabase.rpc("get_org_secret_value", { target_org_id: orgId, target_provider: "anthropic" });
  if (error || !data) {
    throw new LlmCallError(error?.message ?? "no Anthropic key saved for this org", "KEY_INVALID", error);
  }
  return data as string;
}

export type ActivePrompt = { version: number; body: string };

/** The active prompt body for a task (spec §4: prompts are data, in prompt_versions). */
export async function getActivePromptWith(supabase: SupabaseClient, task: Task): Promise<ActivePrompt> {
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("version, body")
    .eq("task", task)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`no active prompt_versions row for task "${task}"`);
  return data as ActivePrompt;
}

/** Per million tokens. Cache writes are the 5-minute TTL price. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheWrite: 5.0, cacheRead: 0.2 },
  "claude-opus-5": { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function estimateUsd(model: string, usage: TokenUsage): number {
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0; // unpriced model: price_table is the source of truth once it carries LLM rows
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1_000_000
  );
}

export async function recordLlmSpend(
  supabase: SupabaseClient,
  { orgId, adId = null, model, usd, task }: { orgId: string; adId?: string | null; model: string; usd: number; task: string }
): Promise<void> {
  const { error } = await supabase.rpc("record_spend_event", {
    target_org_id: orgId,
    target_ad_id: adId,
    target_provider: "anthropic",
    target_model: model,
    target_usd_est: usd,
    target_kind: `llm:${task}`,
  });
  if (error) {
    // Never silently swallowed, but never allowed to throw away real
    // output either: the caller decides.
    throw new LlmCallError(`record_spend_event failed: ${error.message}`, "PROVIDER_ERROR", error);
  }
}

export function mapAnthropicError(err: unknown): LlmCallError {
  if (err instanceof Anthropic.AuthenticationError) return new LlmCallError("Anthropic key is invalid.", "KEY_INVALID", err);
  if (err instanceof Anthropic.RateLimitError) return new LlmCallError("Anthropic rate limit hit.", "RATE_LIMIT", err);
  if (err instanceof Anthropic.APIConnectionError) return new LlmCallError("Could not reach Anthropic.", "TIMEOUT", err);
  if (err instanceof Anthropic.APIError) {
    // billing_error (402, out of credit) has no typed class in the SDK.
    // Out of prepaid credit also comes back as a 400 invalid_request_error.
    if (err.status === 402 || (err.status === 400 && /credit balance is too low/i.test(err.message))) {
      return new LlmCallError("Anthropic key has no credit.", "KEY_NO_CREDIT", err);
    }
    return new LlmCallError(err.message, "PROVIDER_ERROR", err);
  }
  return new LlmCallError(err instanceof Error ? err.message : "unknown Anthropic client error", "PROVIDER_ERROR", err);
}
