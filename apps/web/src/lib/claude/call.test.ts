import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmCall } from "./call";
import { ExampleExtractionSchema } from "./schemas/example-extraction";
import { LlmCallError } from "./types";

// Mocks createServiceClient() — its RPC calls (claim_paid_job,
// get_org_secret_value, record_spend_event) and table reads
// (prompt_versions) are mocked per-test rather than hit live, since
// this file tests llmCall's own orchestration logic (retry, error
// mapping, spend recording), not Supabase itself — that's covered by
// the live verification run separately against the real database.
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: rpcMock,
    from: fromMock,
  }),
}));

function mockPromptVersionsTable(body: string, version = 1) {
  fromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: { version, body }, error: null }),
            }),
          }),
        }),
      }),
    }),
  });
}

function mockHappyRpcs(apiKey: string) {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "claim_paid_job") return { data: null, error: null };
    if (fn === "get_org_secret_value") return { data: apiKey, error: null };
    if (fn === "record_spend_event") return { data: null, error: null };
    throw new Error(`unexpected rpc: ${fn}`);
  });
}

function mockFetchOnce(contentText: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: contentText }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    text: async () => JSON.stringify({}),
  });
}

describe("llmCall", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns validated output on the first attempt when the model answers correctly", async () => {
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-test-key");
    global.fetch = mockFetchOnce(
      JSON.stringify({
        claims: ["works great"],
        benefits: ["saves time"],
        objections: ["price"],
        audience: "busy professionals",
      })
    );

    const result = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    });

    expect(result.output.claims).toEqual(["works great"]);
    expect(result.promptVersion).toBe(1);
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(rpcMock).toHaveBeenCalledWith(
      "record_spend_event",
      expect.objectContaining({ target_org_id: "org-1", target_kind: "llm:example_extraction" })
    );
  });

  it("retries exactly once on a malformed answer, then throws NEEDS_HUMAN", async () => {
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-test-key");
    // Every attempt returns text that isn't valid JSON for the schema.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "not valid json at all" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      text: async () => JSON.stringify({}),
    });

    await expect(
      llmCall({
        task: "example_extraction",
        schema: ExampleExtractionSchema,
        input: { description: "A product." },
        orgId: "org-1",
      })
    ).rejects.toMatchObject({ code: "NEEDS_HUMAN" });

    // Exactly 2 attempts (initial + one retry), confirmed by exactly 2 fetch calls.
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("refuses before spending anything when claim_paid_job reports the org is paused", async () => {
    mockPromptVersionsTable("Extract info");
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "claim_paid_job") {
        return { data: null, error: { message: "org_paused: spend guard has paused this org" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    // claim_paid_job's raw "org_paused: ..." exception is translated
    // into a plain-language message (spend-limit-message.ts) rather
    // than leaked verbatim to the end user — this asserts both the
    // translated message and the SPEND_LIMIT error code land on the
    // thrown LlmCallError.
    const call = llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    });

    await expect(call).rejects.toThrow(/spend guard has paused this org/);
    await expect(call).rejects.toMatchObject({
      code: "SPEND_LIMIT",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a missing Anthropic key to KEY_INVALID without calling the API", async () => {
    mockPromptVersionsTable("Extract info");
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "claim_paid_job") return { data: null, error: null };
      if (fn === "get_org_secret_value") return { data: null, error: { message: "no saved key" } };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const err = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).code).toBe("KEY_INVALID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a 401 from Anthropic to KEY_INVALID", async () => {
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-bad-key");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
      text: async () =>
        JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    });

    const err = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).code).toBe("KEY_INVALID");
  });

  it("maps a 429 from Anthropic to RATE_LIMIT", async () => {
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-test-key");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        type: "error",
        error: { type: "rate_limit_error", message: "rate limited" },
      }),
      text: async () =>
        JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limited" } }),
    });

    const err = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).code).toBe("RATE_LIMIT");
  });

  it("maps a 402 (billing_error — no credit) to KEY_NO_CREDIT, matching spec §4 M4's own error vocabulary", async () => {
    // 402 has no dedicated typed exception class in the Anthropic SDK
    // (confirmed from the claude-api skill's error-codes reference,
    // which lists a distinct class for every other 4xx/5xx but not
    // 402) — this is the one mapping that relies on checking
    // err.status directly rather than an instanceof check, so it gets
    // its own test rather than trusting the same logic the 401/429
    // tests already exercise.
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-no-credit-key");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        type: "error",
        error: { type: "billing_error", message: "your account has insufficient credit" },
      }),
      text: async () =>
        JSON.stringify({ type: "error", error: { type: "billing_error", message: "your account has insufficient credit" } }),
    });

    const err = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).code).toBe("KEY_NO_CREDIT");
  });
  it("maps the 400 'credit balance is too low' error to KEY_NO_CREDIT", async () => {
    // What the API actually returns for a prepaid account with no credit
    // left (seen in production, October 2026), not a 402.
    const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } };
    mockPromptVersionsTable("Extract info");
    mockHappyRpcs("sk-ant-fake-no-credit-key");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    const err = await llmCall({
      task: "example_extraction",
      schema: ExampleExtractionSchema,
      input: { description: "A product." },
      orgId: "org-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).code).toBe("KEY_NO_CREDIT");
  });
});
