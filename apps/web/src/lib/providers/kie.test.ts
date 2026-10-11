import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KieAdapter } from "./kie";
import { ProviderAdapterError } from "./types";
import createTaskSuccess from "./__fixtures__/kie-create-task-success.json";
import recordInfoQueued from "./__fixtures__/kie-record-info-queued.json";
import recordInfoSuccess from "./__fixtures__/kie-record-info-success.json";
import recordInfoFail from "./__fixtures__/kie-record-info-fail.json";
import errorInvalidKey from "./__fixtures__/kie-error-invalid-key.json";

function mockFetchOnce(body: unknown, init?: { ok?: boolean; status?: number }) {
  return vi.fn().mockResolvedValueOnce({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  });
}

describe("KieAdapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("submit() returns the external task id from data.taskId", async () => {
    global.fetch = mockFetchOnce(createTaskSuccess);
    const adapter = new KieAdapter("test-key");

    const result = await adapter.submit({
      kind: "image",
      model: "z-image",
      prompt: "a cat",
    });

    expect(result.externalTaskId).toBe("task_z-image_1765174270120");
  });

  it("submit() sends the model and input.prompt in the request body", async () => {
    const fetchSpy = mockFetchOnce(createTaskSuccess);
    global.fetch = fetchSpy;
    const adapter = new KieAdapter("test-key");

    await adapter.submit({ kind: "image", model: "z-image", prompt: "a cat", aspectRatio: "16:9" });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("z-image");
    expect(body.input.prompt).toBe("a cat");
    expect(body.input.aspect_ratio).toBe("16:9");
  });

  it("poll() maps state=waiting to queued", async () => {
    global.fetch = mockFetchOnce(recordInfoQueued);
    const adapter = new KieAdapter("test-key");

    const result = await adapter.poll("task_z-image_1765174270120");

    expect(result.status).toBe("queued");
    expect(result.resultUrls).toBeUndefined();
  });

  it("poll() maps state=success and parses the stringified resultJson", async () => {
    global.fetch = mockFetchOnce(recordInfoSuccess);
    const adapter = new KieAdapter("test-key");

    const result = await adapter.poll("task_z-image_1765174270120");

    expect(result.status).toBe("succeeded");
    expect(result.resultUrls).toEqual([
      "https://cdn.kie.ai/results/task_z-image_1765174270120/output_1.png",
    ]);
  });

  it("poll() maps state=fail to failed with the provider's failMsg", async () => {
    global.fetch = mockFetchOnce(recordInfoFail);
    const adapter = new KieAdapter("test-key");

    const result = await adapter.poll("task_z-image_1765174270120");

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("PROVIDER_ERROR");
    expect(result.errorMessage).toBe("Content policy violation detected in prompt.");
  });

  it("throws KEY_INVALID when the body code is 401, even though HTTP status is 200", async () => {
    global.fetch = mockFetchOnce(errorInvalidKey, { ok: true, status: 200 });
    const adapter = new KieAdapter("bad-key");

    await expect(adapter.submit({ kind: "image", model: "z-image", prompt: "x" })).rejects.toMatchObject({
      code: "KEY_INVALID",
    } satisfies Partial<ProviderAdapterError>);
  });

  it("cancel() always reports not_supported — no documented cancel endpoint exists for kie.ai", async () => {
    const adapter = new KieAdapter("test-key");
    const result = await adapter.cancel("task_z-image_1765174270120");
    expect(result).toEqual({ ok: false, reason: "not_supported" });
  });

  it("an undocumented state value is treated as still running, not silently terminal", async () => {
    global.fetch = mockFetchOnce({
      code: 200,
      msg: "success",
      data: { taskId: "t1", state: "some_future_state" },
    });
    const adapter = new KieAdapter("test-key");

    const result = await adapter.poll("t1");

    expect(result.status).toBe("running");
  });
});
