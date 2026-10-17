// No "server-only" guard: same reasoning as kie.ts/fal.ts — imported
// from both Next.js server code and Trigger.dev tasks.
import type {
  ProviderAdapter,
  SubmitParams,
  EstimateResult,
  SubmitResult,
  PollResult,
  CancelResult,
  JobStatus,
  ProviderErrorCode,
} from "./types";
import { ProviderAdapterError } from "./types";

export const HIGGSFIELD_API_BASE = "https://api.higgsfield.ai";

/**
 * Per-endpoint request mapping, read from each model's page on
 * docs.higgsfield.ai (2026-10-17). Most Higgsfield schemas set
 * additionalProperties: false, so the adapter only ever sends fields a
 * model documents: everything else in SubmitParams.extra is dropped.
 *
 * `fixed` pins a field whose value changes the price tier, so the
 * price_table row for the endpoint (seed_price_table.sql) is always the
 * tier actually requested. `enums` drops values a model doesn't accept
 * (the provider default applies instead). `integers` coerces fields the
 * app passes as strings (e.g. duration) into the integers Higgsfield
 * requires.
 */
type EndpointSpec = {
  kind: "image" | "video";
  /** Where reference/first-frame images go: an array field (capped) or a single URL field. */
  images?: { field: string; max: number } | { field: string; single: true };
  /** Whether the model accepts aspect_ratio, and which values. */
  aspectRatios?: string[];
  /** extra keys passed through (after enum/integer checks). */
  allowed: string[];
  enums?: Record<string, (string | number)[]>;
  integers?: string[];
  fixed?: Record<string, unknown>;
};

export const HIGGSFIELD_ENDPOINTS: Record<string, EndpointSpec> = {
  // Images
  "marketing-studio/image/flare": {
    kind: "image",
    images: { field: "image_urls", max: 16 },
    aspectRatios: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"],
    allowed: ["resolution", "quality"],
    // 4k and xhigh/max are left out: their price is far above the
    // per-image estimate the price_table row carries.
    enums: { resolution: ["1k", "2k"], quality: ["low", "medium", "high"] },
    fixed: { enhance_prompt: false },
  },
  "xai/grok-imagine-image-2.0": {
    kind: "image",
    images: { field: "image_urls", max: 10 },
    aspectRatios: ["auto", "1:1", "1:2", "2:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    allowed: ["resolution", "quality"],
    enums: { resolution: ["1k", "2k"], quality: ["low", "medium"] },
  },
  "higgsfield-ai/soul/v2/standard": {
    kind: "image",
    // Text-to-image only: reference images are not accepted.
    aspectRatios: ["9:16", "16:9", "4:3", "3:4", "1:1", "2:3", "3:2"],
    allowed: ["enhance_prompt"],
    fixed: { resolution: "1080p", batch_size: 1 },
  },
  "ideogram/v4.0": {
    kind: "image",
    images: { field: "image_url", single: true },
    aspectRatios: [
      "1:1", "1:2", "2:1", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9", "5:8", "8:5", "3:4", "4:3",
      "9:22", "22:9", "9:23", "23:9", "3:8", "8:3", "5:12", "12:5", "1:3", "3:1",
    ],
    allowed: ["rendering_speed", "image_weight"],
    enums: { rendering_speed: ["TURBO", "DEFAULT", "QUALITY"] },
    integers: ["image_weight"],
  },

  // Videos (image-to-video from the scene still)
  "kling-video/v3.0/std/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    allowed: ["duration", "sound", "cfg_scale"],
    enums: { sound: ["on", "off"] },
    integers: ["duration"],
  },
  "kling-video/v3.0/pro/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    allowed: ["duration", "sound", "cfg_scale"],
    enums: { sound: ["on", "off"] },
    integers: ["duration"],
  },
  "alibaba/wan-3.0/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
    allowed: ["duration", "generate_audio"],
    integers: ["duration"],
    fixed: { resolution: "1080p" },
  },
  "minimax/h3/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    aspectRatios: ["auto", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    allowed: ["duration"],
    integers: ["duration"],
    fixed: { resolution: "2K" },
  },
  "minimax/hailuo-2.3/standard/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    allowed: ["duration", "prompt_optimizer"],
    enums: { duration: [6, 10] },
    integers: ["duration"],
  },
  "alibaba/happy-horse/v1.1/image-to-video": {
    kind: "video",
    images: { field: "image_url", single: true },
    allowed: ["duration"],
    integers: ["duration"],
    fixed: { resolution: "1080p" },
  },
};

/**
 * Higgsfield Cloud API adapter (docs.higgsfield.ai, read 2026-10-17).
 * POST {base}/{endpoint} submits and returns request_id/status_url/
 * cancel_url; GET /requests/{id}/status polls (queued, in_progress,
 * completed, failed, nsfw, canceled); POST /requests/{id}/cancel
 * cancels while still queued (202) and answers 400 once processing has
 * started. Failed, nsfw and canceled requests are refunded by
 * Higgsfield, so none of them are charged.
 *
 * The credential is "KEY_ID:KEY_SECRET", sent as
 * `Authorization: Key KEY_ID:KEY_SECRET`. The request id is the
 * external task id: status and cancel URLs don't need the endpoint.
 */
export class HiggsfieldAdapter implements ProviderAdapter {
  readonly provider = "higgsfield";

  constructor(private readonly apiKey: string) {}

  async estimate(): Promise<EstimateResult> {
    // Higgsfield does have POST /estimate/{endpoint}, but spend is
    // priced from price_table before submit (run-provider-job.ts), the
    // same as every other provider, so this stays a placeholder.
    return { usdEstimate: 0 };
  }

  async submit(params: SubmitParams): Promise<SubmitResult> {
    const body = buildHiggsfieldBody(params);

    const res = await this.fetchJson<HiggsfieldRequestResponse>(
      "POST",
      `${HIGGSFIELD_API_BASE}/${params.model}`,
      body,
      // One key per intended generation: if this exact request is ever
      // retried after a lost response, Higgsfield returns the original
      // request instead of charging for a second one.
      { "Idempotency-Key": crypto.randomUUID() }
    );

    if (!res.request_id) {
      throw new ProviderAdapterError("Higgsfield submit response had no request_id", "PROVIDER_ERROR", res);
    }
    return { externalTaskId: res.request_id };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const res = await this.fetchJson<HiggsfieldRequestResponse>(
      "GET",
      `${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(externalTaskId)}/status`
    );

    const status = mapHiggsfieldStatus(res.status);

    if (status === "succeeded") {
      const resultUrls = [...(res.images ?? []), ...(res.video ? [res.video] : [])]
        .map((item) => item?.url)
        .filter((url): url is string => typeof url === "string");
      return { status, resultUrls, raw: res };
    }

    if (status === "failed") {
      if (res.status === "nsfw") {
        return {
          status,
          errorCode: "CONTENT_BLOCK",
          errorMessage: "Higgsfield's content moderation rejected this prompt or its output.",
          raw: res,
        };
      }
      return {
        status,
        errorCode: "PROVIDER_ERROR",
        errorMessage:
          res.status === "canceled" ? "The Higgsfield request was canceled." : res.error ?? "Higgsfield generation failed.",
        raw: res,
      };
    }

    return { status, raw: res };
  }

  async cancel(externalTaskId: string): Promise<CancelResult> {
    let res: Response;
    try {
      res = await fetch(`${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(externalTaskId)}/cancel`, {
        method: "POST",
        headers: { Authorization: `Key ${this.apiKey}` },
      });
    } catch {
      return { ok: false, reason: "provider_error" };
    }

    if (res.status === 202) return { ok: true, status: "cancelled" };
    // 400: processing already started. Higgsfield can't stop it and
    // will bill it, so this is NOT reported as cancelled.
    if (res.status === 400) return { ok: false, reason: "already_started" };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "provider_error" };
  }

  private async fetchJson<T>(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ProviderAdapterError("Higgsfield request failed to send", "TIMEOUT");
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => undefined);
      throw new ProviderAdapterError(
        describeHiggsfieldError(res.status, bodyText),
        mapHiggsfieldHttpStatus(res.status, bodyText),
        bodyText
      );
    }

    const json = (await res.json().catch(() => null)) as T | null;
    if (json === null) {
      throw new ProviderAdapterError("Higgsfield returned a non-JSON response", "PROVIDER_ERROR");
    }
    return json;
  }
}

/** Exported for tests: the exact JSON body sent for a submit. */
export function buildHiggsfieldBody(params: SubmitParams): Record<string, unknown> {
  const spec = HIGGSFIELD_ENDPOINTS[params.model];
  if (!spec) {
    // Never guess a request shape for an endpoint whose schema hasn't
    // been read: Higgsfield rejects unknown fields.
    throw new ProviderAdapterError(`Higgsfield model ${params.model} is not supported yet.`, "PROVIDER_ERROR");
  }

  const body: Record<string, unknown> = { prompt: params.prompt };

  const refs = params.referenceImageUrls ?? [];
  if (spec.images && refs.length > 0) {
    if ("single" in spec.images) body[spec.images.field] = refs[0];
    else body[spec.images.field] = refs.slice(0, spec.images.max);
  }
  if (spec.kind === "video" && spec.images && refs.length === 0) {
    throw new ProviderAdapterError("This Higgsfield video model needs a starting image.", "PROVIDER_ERROR");
  }

  if (params.aspectRatio && spec.aspectRatios?.includes(params.aspectRatio)) {
    body.aspect_ratio = params.aspectRatio;
  }

  for (const [key, raw] of Object.entries(params.extra ?? {})) {
    if (!spec.allowed.includes(key) || raw === undefined || raw === null) continue;
    let value: unknown = raw;
    if (spec.integers?.includes(key)) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) continue;
      value = n;
    }
    // The app's generic "sound: true" audio hint maps onto Kling's on/off enum.
    if (key === "sound" && typeof value === "boolean") value = value ? "on" : "off";
    const allowedValues = spec.enums?.[key];
    if (allowedValues && !allowedValues.includes(value as string | number)) continue;
    body[key] = value;
  }

  Object.assign(body, spec.fixed);
  return body;
}

export function isHiggsfieldEndpoint(endpoint: string): boolean {
  return endpoint in HIGGSFIELD_ENDPOINTS;
}

type HiggsfieldMedia = { url?: string };

type HiggsfieldRequestResponse = {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled" | string;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: HiggsfieldMedia[];
  video?: HiggsfieldMedia;
};

function mapHiggsfieldStatus(status: string): JobStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "in_progress":
      return "running";
    case "completed":
      return "succeeded";
    case "failed":
    case "nsfw":
    case "canceled":
      return "failed";
    default:
      // Unknown state: keep polling rather than act on it as terminal.
      return "running";
  }
}

/** Status codes per docs.higgsfield.ai/docs/concepts/errors. */
function mapHiggsfieldHttpStatus(httpStatus: number, bodyText?: string): ProviderErrorCode {
  if (httpStatus === 401) return "KEY_INVALID";
  if (httpStatus === 403) return "KEY_NO_CREDIT";
  // Concurrency limit is a 400 whose detail names it (no 429/Retry-After).
  if (httpStatus === 400 && bodyText && /concurrent/i.test(bodyText)) return "RATE_LIMIT";
  if (httpStatus === 423 || httpStatus === 503) return "RATE_LIMIT";
  return "PROVIDER_ERROR";
}

function describeHiggsfieldError(httpStatus: number, bodyText?: string): string {
  const detail = extractDetail(bodyText);
  switch (httpStatus) {
    case 401:
      return "Higgsfield rejected the API key. Check the key ID and secret saved for this brand.";
    case 403:
      return "The Higgsfield account is out of credits. Add funds at cloud.higgsfield.ai.";
    case 404:
      return "This Higgsfield model isn't available to the saved key's account.";
    case 423:
    case 503:
      return "This Higgsfield model is temporarily unavailable. Try again later or pick another model.";
    default:
      return detail ? `Higgsfield: ${detail}` : `Higgsfield returned HTTP ${httpStatus}`;
  }
}

function extractDetail(bodyText?: string): string | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail.slice(0, 300);
    if (Array.isArray(parsed.detail)) {
      const msgs = parsed.detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
        .filter(Boolean);
      return msgs.length ? msgs.join("; ").slice(0, 300) : null;
    }
  } catch {
    // not JSON
  }
  return null;
}
