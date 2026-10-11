import "server-only";
import { ProviderAdapterError } from "./types";
import type { ProviderAdapter, SubmitParams, SubmitResult } from "./types";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests — real callers never pass this. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests — controls the jitter without making tests flaky. */
  random?: () => number;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-jitter exponential backoff, spec §5.3's "rate-limit backoff with
 * jitter": base * 2^attempt, capped at maxDelayMs, then a uniform
 * random delay between 0 and that cap — not a fixed delay plus a small
 * random wobble, which still lets many clients collide on the same
 * retry tick after a shared rate-limit event.
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "random">>
): number {
  const exponential = options.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, options.maxDelayMs);
  return Math.floor(options.random() * capped);
}

/**
 * Retries submit() on a RATE_LIMIT error only — every other error code
 * (KEY_INVALID, KEY_NO_CREDIT, CONTENT_BLOCK, PROVIDER_ERROR, TIMEOUT)
 * is not transient in the way rate limiting is, so retrying them would
 * just burn attempts and, for CONTENT_BLOCK, money on a request that
 * will fail the same way every time without a prompt change — that
 * case is handled separately by rewordAndRetry below, not here.
 */
export async function submitWithRateLimitBackoff(
  adapter: ProviderAdapter,
  params: SubmitParams,
  options: RetryOptions = {}
): Promise<SubmitResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await adapter.submit(params);
    } catch (err) {
      lastError = err;

      const isRateLimit = err instanceof ProviderAdapterError && err.code === "RATE_LIMIT";
      const isLastAttempt = attempt === maxAttempts - 1;

      if (!isRateLimit || isLastAttempt) {
        throw err;
      }

      const delayMs = computeBackoffDelayMs(attempt, { baseDelayMs, maxDelayMs, random });
      await sleep(delayMs);
    }
  }

  // Unreachable — the loop always either returns or throws — but
  // keeps TypeScript's control-flow analysis happy without a non-null
  // assertion on lastError.
  throw lastError;
}

export type RewordFn = (prompt: string, reason: string | undefined) => Promise<string>;

/**
 * Content-block reword and retry, spec §5.6: "Content-filter block:
 * reword only the offending wording, retry up to 2 times, show an
 * orange note with what changed. After that, show a clear error."
 * rewordFn is injected (an LLM call, M4) rather than implemented here
 * — this function owns the retry loop and the "what changed" note,
 * not prompt rewriting itself.
 */
export async function submitWithContentBlockReword(
  adapter: ProviderAdapter,
  params: SubmitParams,
  rewordFn: RewordFn,
  maxRewordAttempts = 2
): Promise<{ result: SubmitResult; finalParams: SubmitParams; rewordNotes: string[] }> {
  let currentParams = params;
  const rewordNotes: string[] = [];

  for (let attempt = 0; attempt <= maxRewordAttempts; attempt++) {
    try {
      const result = await adapter.submit(currentParams);
      return { result, finalParams: currentParams, rewordNotes };
    } catch (err) {
      const isContentBlock = err instanceof ProviderAdapterError && err.code === "CONTENT_BLOCK";
      const isLastAttempt = attempt === maxRewordAttempts;

      if (!isContentBlock || isLastAttempt) {
        throw err;
      }

      const rewordedPrompt = await rewordFn(
        currentParams.prompt,
        err instanceof ProviderAdapterError ? err.message : undefined
      );
      rewordNotes.push(
        `Reworded after a content-filter block (attempt ${attempt + 1}/${maxRewordAttempts}).`
      );
      currentParams = { ...currentParams, prompt: rewordedPrompt };
    }
  }

  // Unreachable — the loop above always returns or throws on its last
  // iteration — but keeps the function's return type total.
  throw new ProviderAdapterError("submitWithContentBlockReword: unreachable", "PROVIDER_ERROR");
}
