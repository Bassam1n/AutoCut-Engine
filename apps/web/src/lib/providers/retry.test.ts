import { describe, it, expect, vi } from "vitest";
import {
  submitWithRateLimitBackoff,
  submitWithContentBlockReword,
  computeBackoffDelayMs,
} from "./retry";
import { ProviderAdapterError } from "./types";
import type { ProviderAdapter, SubmitParams, SubmitResult, EstimateResult, PollResult, CancelResult } from "./types";

function fakeAdapter(submitImpl: (params: SubmitParams) => Promise<SubmitResult>): ProviderAdapter {
  return {
    provider: "fake",
    estimate: async (): Promise<EstimateResult> => ({ usdEstimate: 0 }),
    submit: submitImpl,
    poll: async (): Promise<PollResult> => ({ status: "queued" }),
    cancel: async (): Promise<CancelResult> => ({ ok: false, reason: "not_supported" }),
  };
}

const params: SubmitParams = { kind: "image", model: "test", prompt: "a cat" };

describe("computeBackoffDelayMs", () => {
  it("grows exponentially with attempt number, capped at maxDelayMs", () => {
    const random = () => 1; // deterministic: always the max of the range
    expect(computeBackoffDelayMs(0, { baseDelayMs: 1000, maxDelayMs: 30_000, random })).toBe(1000);
    expect(computeBackoffDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000, random })).toBe(2000);
    expect(computeBackoffDelayMs(2, { baseDelayMs: 1000, maxDelayMs: 30_000, random })).toBe(4000);
    // attempt 5: 1000 * 2^5 = 32000, capped at 30000
    expect(computeBackoffDelayMs(5, { baseDelayMs: 1000, maxDelayMs: 30_000, random })).toBe(30_000);
  });

  it("is full-jitter — a random() of 0 always returns 0 delay", () => {
    const random = () => 0;
    expect(computeBackoffDelayMs(3, { baseDelayMs: 1000, maxDelayMs: 30_000, random })).toBe(0);
  });
});

describe("submitWithRateLimitBackoff", () => {
  it("succeeds on the first attempt without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const adapter = fakeAdapter(async () => ({ externalTaskId: "t1" }));

    const result = await submitWithRateLimitBackoff(adapter, params, { sleep });

    expect(result.externalTaskId).toBe("t1");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on RATE_LIMIT and eventually succeeds", async () => {
    let calls = 0;
    const adapter = fakeAdapter(async () => {
      calls++;
      if (calls < 3) throw new ProviderAdapterError("rate limited", "RATE_LIMIT");
      return { externalTaskId: "t1" };
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await submitWithRateLimitBackoff(adapter, params, { sleep, random: () => 0.5 });

    expect(result.externalTaskId).toBe("t1");
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-RATE_LIMIT error, even on the first attempt", async () => {
    const adapter = fakeAdapter(async () => {
      throw new ProviderAdapterError("bad key", "KEY_INVALID");
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(submitWithRateLimitBackoff(adapter, params, { sleep })).rejects.toMatchObject({
      code: "KEY_INVALID",
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and throws the last RATE_LIMIT error", async () => {
    const adapter = fakeAdapter(async () => {
      throw new ProviderAdapterError("still rate limited", "RATE_LIMIT");
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      submitWithRateLimitBackoff(adapter, params, { sleep, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(sleep).toHaveBeenCalledTimes(2); // 3 attempts, 2 delays between them
  });
});

describe("submitWithContentBlockReword", () => {
  it("rewords and retries on CONTENT_BLOCK, then succeeds", async () => {
    let calls = 0;
    const adapter = fakeAdapter(async (p) => {
      calls++;
      if (calls === 1) {
        expect(p.prompt).toBe("a cat");
        throw new ProviderAdapterError("blocked", "CONTENT_BLOCK");
      }
      expect(p.prompt).toBe("a cat (reworded)");
      return { externalTaskId: "t1" };
    });

    const rewordFn = vi.fn(async (prompt: string) => `${prompt} (reworded)`);

    const { result, finalParams, rewordNotes } = await submitWithContentBlockReword(
      adapter,
      params,
      rewordFn
    );

    expect(result.externalTaskId).toBe("t1");
    expect(finalParams.prompt).toBe("a cat (reworded)");
    expect(rewordNotes).toHaveLength(1);
    expect(rewordFn).toHaveBeenCalledTimes(1);
  });

  it("does not reword a non-CONTENT_BLOCK error", async () => {
    const adapter = fakeAdapter(async () => {
      throw new ProviderAdapterError("rate limited", "RATE_LIMIT");
    });
    const rewordFn = vi.fn();

    await expect(
      submitWithContentBlockReword(adapter, params, rewordFn)
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(rewordFn).not.toHaveBeenCalled();
  });

  it("stops after maxRewordAttempts and throws a clear CONTENT_BLOCK error", async () => {
    const adapter = fakeAdapter(async () => {
      throw new ProviderAdapterError("still blocked", "CONTENT_BLOCK");
    });
    const rewordFn = vi.fn(async (prompt: string) => `${prompt} (reworded)`);

    await expect(
      submitWithContentBlockReword(adapter, params, rewordFn, 2)
    ).rejects.toMatchObject({ code: "CONTENT_BLOCK" });
    expect(rewordFn).toHaveBeenCalledTimes(2);
  });
});
