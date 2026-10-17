import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HiggsfieldAdapter, buildHiggsfieldBody } from "./higgsfield";
import { adapterFor } from "./adapter-for";
import submitQueued from "./__fixtures__/higgsfield-submit-queued.json";
import statusInProgress from "./__fixtures__/higgsfield-status-in-progress.json";
import statusCompletedImage from "./__fixtures__/higgsfield-status-completed-image.json";
import statusCompletedVideo from "./__fixtures__/higgsfield-status-completed-video.json";
import statusFailed from "./__fixtures__/higgsfield-status-failed.json";
import statusNsfw from "./__fixtures__/higgsfield-status-nsfw.json";
import errorInvalidCredentials from "./__fixtures__/higgsfield-error-invalid-credentials.json";
import errorConcurrency from "./__fixtures__/higgsfield-error-concurrency.json";

const REQUEST_ID = "3f1c2a9e-5b7d-4e8a-9c1f-2d6b8e0a4f17";
const KEY = "key-id:key-secret";

function mockFetchSequence(responses: { body: unknown; ok?: boolean; status?: number }[]) {
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

describe("HiggsfieldAdapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("adapterFor() returns the Higgsfield adapter", () => {
    expect(adapterFor("higgsfield", KEY).provider).toBe("higgsfield");
  });

  it("submit() posts to api.higgsfield.ai/{endpoint} with Key auth and an idempotency key", async () => {
    const fetchSpy = mockFetchSequence([{ body: submitQueued }]);
    global.fetch = fetchSpy;

    const result = await new HiggsfieldAdapter(KEY).submit({
      kind: "image",
      model: "marketing-studio/image/flare",
      prompt: "a ceramic vase",
    });

    expect(result.externalTaskId).toBe(REQUEST_ID);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.higgsfield.ai/marketing-studio/image/flare");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Key key-id:key-secret");
    expect(init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body)).toEqual({ prompt: "a ceramic vase", enhance_prompt: false });
  });

  it("submit() refuses an endpoint whose schema isn't mapped, without calling the API", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    await expect(
      new HiggsfieldAdapter(KEY).submit({ kind: "image", model: "some/unknown-model", prompt: "x" })
    ).rejects.toThrow(/not supported/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submit() maps 401 to KEY_INVALID and a concurrency 400 to RATE_LIMIT", async () => {
    global.fetch = mockFetchSequence([
      { body: errorInvalidCredentials, ok: false, status: 401 },
      { body: errorConcurrency, ok: false, status: 400 },
    ]);
    const adapter = new HiggsfieldAdapter(KEY);
    const params = { kind: "image" as const, model: "ideogram/v4.0", prompt: "a sign" };

    await expect(adapter.submit(params)).rejects.toMatchObject({ code: "KEY_INVALID" });
    await expect(adapter.submit(params)).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("submit() maps 403 (out of credits) to KEY_NO_CREDIT", async () => {
    global.fetch = mockFetchSequence([{ body: { detail: "Not enough credits" }, ok: false, status: 403 }]);

    await expect(
      new HiggsfieldAdapter(KEY).submit({ kind: "image", model: "ideogram/v4.0", prompt: "a sign" })
    ).rejects.toMatchObject({ code: "KEY_NO_CREDIT" });
  });

  it("poll() maps in_progress to running", async () => {
    const fetchSpy = mockFetchSequence([{ body: statusInProgress }]);
    global.fetch = fetchSpy;

    const result = await new HiggsfieldAdapter(KEY).poll(REQUEST_ID);

    expect(result.status).toBe("running");
    expect(fetchSpy.mock.calls[0][0]).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}/status`);
  });

  it("poll() on completed returns images[].url", async () => {
    global.fetch = mockFetchSequence([{ body: statusCompletedImage }]);

    const result = await new HiggsfieldAdapter(KEY).poll(REQUEST_ID);

    expect(result).toMatchObject({
      status: "succeeded",
      resultUrls: ["https://cdn.higgsfield.ai/output/image-1.png"],
    });
  });

  it("poll() on completed returns video.url", async () => {
    global.fetch = mockFetchSequence([{ body: statusCompletedVideo }]);

    const result = await new HiggsfieldAdapter(KEY).poll(REQUEST_ID);

    expect(result.resultUrls).toEqual(["https://cdn.higgsfield.ai/output/video.mp4"]);
  });

  it("poll() maps failed to PROVIDER_ERROR with the provider's message", async () => {
    global.fetch = mockFetchSequence([{ body: statusFailed }]);

    const result = await new HiggsfieldAdapter(KEY).poll(REQUEST_ID);

    expect(result).toMatchObject({ status: "failed", errorCode: "PROVIDER_ERROR", errorMessage: "Generation failed" });
  });

  it("poll() maps nsfw to CONTENT_BLOCK", async () => {
    global.fetch = mockFetchSequence([{ body: statusNsfw }]);

    const result = await new HiggsfieldAdapter(KEY).poll(REQUEST_ID);

    expect(result).toMatchObject({ status: "failed", errorCode: "CONTENT_BLOCK" });
  });

  it("cancel() maps 202 to cancelled", async () => {
    const fetchSpy = mockFetchSequence([{ body: null, status: 202 }]);
    global.fetch = fetchSpy;

    const result = await new HiggsfieldAdapter(KEY).cancel(REQUEST_ID);

    expect(result).toEqual({ ok: true, status: "cancelled" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}/cancel`);
    expect(init.method).toBe("POST");
  });

  it("cancel() maps 400 (already processing) to already_started, never cancelled", async () => {
    global.fetch = mockFetchSequence([{ body: { detail: "Request already started" }, ok: false, status: 400 }]);

    const result = await new HiggsfieldAdapter(KEY).cancel(REQUEST_ID);

    expect(result).toEqual({ ok: false, reason: "already_started" });
  });

  it("cancel() maps 404 to not_found", async () => {
    global.fetch = mockFetchSequence([{ body: { detail: "Not found" }, ok: false, status: 404 }]);

    expect(await new HiggsfieldAdapter(KEY).cancel(REQUEST_ID)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("buildHiggsfieldBody", () => {
  it("sends only documented fields and caps reference images", () => {
    const refs = Array.from({ length: 12 }, (_, i) => `https://x.test/${i}.png`);
    const body = buildHiggsfieldBody({
      kind: "image",
      model: "xai/grok-imagine-image-2.0",
      prompt: "p",
      referenceImageUrls: refs,
      aspectRatio: "9:16",
      extra: { resolution: "2k", quality: "high", num_images: 4 },
    });

    expect(body).toEqual({ prompt: "p", image_urls: refs.slice(0, 10), aspect_ratio: "9:16", resolution: "2k" });
  });

  it("drops reference images for a text-only model and pins its priced resolution", () => {
    const body = buildHiggsfieldBody({
      kind: "image",
      model: "higgsfield-ai/soul/v2/standard",
      prompt: "p",
      referenceImageUrls: ["https://x.test/a.png"],
      extra: { resolution: "720p" },
    });

    expect(body).toEqual({ prompt: "p", resolution: "1080p", batch_size: 1 });
  });

  it("keeps Marketing Studio off the 4k tier its price row doesn't cover", () => {
    const body = buildHiggsfieldBody({
      kind: "image",
      model: "marketing-studio/image/flare",
      prompt: "p",
      extra: { resolution: "4k", quality: "max" },
    });

    expect(body).toEqual({ prompt: "p", enhance_prompt: false });
  });

  it("maps a video's first frame and coerces the app's string duration to an integer", () => {
    const body = buildHiggsfieldBody({
      kind: "video",
      model: "kling-video/v3.0/std/image-to-video",
      prompt: "slow push-in",
      referenceImageUrls: ["https://x.test/still.png", "https://x.test/other.png"],
      aspectRatio: "9:16",
      extra: { duration: "7", sound: "off" },
    });

    // Kling's image-to-video has no aspect_ratio field: it follows the still.
    expect(body).toEqual({ prompt: "slow push-in", image_url: "https://x.test/still.png", duration: 7, sound: "off" });
  });

  it("maps a boolean sound hint onto Kling's on/off enum", () => {
    const body = buildHiggsfieldBody({
      kind: "video",
      model: "kling-video/v3.0/pro/image-to-video",
      prompt: "p",
      referenceImageUrls: ["https://x.test/still.png"],
      extra: { sound: true },
    });

    expect(body.sound).toBe("on");
  });

  it("drops a duration outside an enum (Hailuo takes 6 or 10 only)", () => {
    const body = buildHiggsfieldBody({
      kind: "video",
      model: "minimax/hailuo-2.3/standard/image-to-video",
      prompt: "p",
      referenceImageUrls: ["https://x.test/still.png"],
      extra: { duration: "8" },
    });

    expect(body).not.toHaveProperty("duration");
  });

  it("refuses an image-to-video submit with no starting image", () => {
    expect(() =>
      buildHiggsfieldBody({ kind: "video", model: "minimax/h3/image-to-video", prompt: "p", extra: { duration: "5" } })
    ).toThrow(/starting image/);
  });
});
