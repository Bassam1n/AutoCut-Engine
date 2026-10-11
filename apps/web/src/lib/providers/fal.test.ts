import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FalAdapter } from "./fal";
import submitSuccess from "./__fixtures__/fal-submit-success.json";
import statusInQueue from "./__fixtures__/fal-status-in-queue.json";
import statusCompleted from "./__fixtures__/fal-status-completed.json";
import statusCompletedFailed from "./__fixtures__/fal-status-completed-failed.json";
import resultImage from "./__fixtures__/fal-result-image.json";
import cancelAccepted from "./__fixtures__/fal-cancel-accepted.json";
import errorContentPolicy from "./__fixtures__/fal-error-content-policy.json";

function mockFetchSequence(
  responses: { body: unknown; ok?: boolean; status?: number }[]
) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    });
  }
  return fn;
}

describe("FalAdapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("submit() returns an external task id combining model and request_id", async () => {
    global.fetch = mockFetchSequence([{ body: submitSuccess }]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.submit({
      kind: "image",
      model: "fal-ai/flux/dev",
      prompt: "a cat",
    });

    expect(result.externalTaskId).toBe(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );
  });

  it("submit() posts to https://queue.fal.run/{model}", async () => {
    const fetchSpy = mockFetchSequence([{ body: submitSuccess }]);
    global.fetch = fetchSpy;
    const adapter = new FalAdapter("test-key");

    await adapter.submit({ kind: "image", model: "fal-ai/flux/dev", prompt: "a cat" });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://queue.fal.run/fal-ai/flux/dev");
    expect(init.headers.Authorization).toBe("Key test-key");
  });

  it("poll() maps IN_QUEUE to queued without fetching the result", async () => {
    const fetchSpy = mockFetchSequence([{ body: statusInQueue }]);
    global.fetch = fetchSpy;
    const adapter = new FalAdapter("test-key");

    const result = await adapter.poll(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result.status).toBe("queued");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("poll() on COMPLETED fetches the result and maps images[].url to resultUrls", async () => {
    global.fetch = mockFetchSequence([
      { body: statusCompleted },
      { body: resultImage },
    ]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.poll(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result.status).toBe("succeeded");
    expect(result.resultUrls).toEqual([
      "https://fal.media/files/results/abc123/output.png",
    ]);
  });

  it("poll() on a COMPLETED status carrying an error field reports failed, not succeeded", async () => {
    global.fetch = mockFetchSequence([{ body: statusCompletedFailed }]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.poll(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Content policy violation.");
  });

  it("cancel() maps HTTP 202 to ok/cancelled", async () => {
    global.fetch = mockFetchSequence([{ body: cancelAccepted, status: 202 }]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.cancel(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result).toEqual({ ok: true, status: "cancelled" });
  });

  it("cancel() maps HTTP 400 to ok/already_completed", async () => {
    global.fetch = mockFetchSequence([
      { body: { status: "ALREADY_COMPLETED" }, status: 400 },
    ]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.cancel(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result).toEqual({ ok: true, status: "already_completed" });
  });

  it("cancel() maps HTTP 404 to not_found", async () => {
    global.fetch = mockFetchSequence([
      { body: { status: "NOT_FOUND" }, status: 404 },
    ]);
    const adapter = new FalAdapter("test-key");

    const result = await adapter.cancel(
      "fal-ai/flux/dev::764cabcf-b745-4b3e-ae38-1200304cf45b"
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("poll() throws on a malformed external task id missing the :: separator", async () => {
    const adapter = new FalAdapter("test-key");
    await expect(adapter.poll("not-a-valid-id")).rejects.toThrow(/malformed/i);
  });

  it("submit() maps a 422 content_policy_violation response to CONTENT_BLOCK", async () => {
    global.fetch = mockFetchSequence([
      { body: errorContentPolicy, ok: false, status: 422 },
    ]);
    const adapter = new FalAdapter("test-key");

    await expect(
      adapter.submit({ kind: "image", model: "fal-ai/flux/dev", prompt: "x" })
    ).rejects.toMatchObject({
      code: "CONTENT_BLOCK",
      message: "The content could not be processed because it contained material flagged by a content checker.",
    });
  });

  it("submit() maps a 422 WITHOUT content_policy_violation to PROVIDER_ERROR, not CONTENT_BLOCK", async () => {
    global.fetch = mockFetchSequence([
      {
        body: { detail: [{ type: "missing", msg: "field required", loc: ["body", "model"] }] },
        ok: false,
        status: 422,
      },
    ]);
    const adapter = new FalAdapter("test-key");

    await expect(
      adapter.submit({ kind: "image", model: "fal-ai/flux/dev", prompt: "x" })
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
