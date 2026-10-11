import "server-only";
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

const QUEUE_BASE = "https://queue.fal.run";

/**
 * fal.ai adapter. Contract confirmed against fal.ai's own docs before
 * writing this: POST https://queue.fal.run/{model_id} to submit,
 * GET .../requests/{request_id}/status to poll (uppercase status
 * values: IN_QUEUE, IN_PROGRESS, COMPLETED), GET .../requests/{id} for
 * the result body once COMPLETED, PUT .../requests/{id}/cancel to
 * cancel. Unlike kie.ai, fal.ai uses real HTTP status codes for
 * transport errors — only the request body shape is provider-specific.
 *
 * The external task id this adapter persists is the model_id and
 * request_id joined together (`${modelId}::${requestId}`), because
 * every subsequent fal.ai call needs the model_id back in its URL and
 * the job runner only stores one external_task_id column per job.
 */
export class FalAdapter implements ProviderAdapter {
  readonly provider = "fal";

  constructor(private readonly apiKey: string) {}

  async estimate(): Promise<EstimateResult> {
    // Same reasoning as KieAdapter.estimate(): fal.ai exposes a
    // pricing-lookup endpoint (GET /v1/models/pricing) but not a
    // per-request cost estimate before submission, so cost comes from
    // price_table (spec §4), not this adapter.
    return { usdEstimate: 0 };
  }

  async submit(params: SubmitParams): Promise<SubmitResult> {
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.referenceImageUrls?.length
        ? { image_urls: params.referenceImageUrls }
        : {}),
      ...params.extra,
    };

    const res = await this.fetchJson<FalSubmitResponse>(
      "POST",
      `${QUEUE_BASE}/${params.model}`,
      body
    );

    if (!res.request_id) {
      throw new ProviderAdapterError(
        "fal.ai submit response had no request_id",
        "PROVIDER_ERROR",
        res
      );
    }

    return { externalTaskId: `${params.model}::${res.request_id}` };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const { modelId, requestId } = splitTaskId(externalTaskId);

    const statusRes = await this.fetchJson<FalStatusResponse>(
      "GET",
      `${QUEUE_BASE}/${modelId}/requests/${requestId}/status`
    );

    // fal.ai's queue only has three lifecycle states — IN_QUEUE,
    // IN_PROGRESS, COMPLETED — there is no separate FAILED state.
    // Confirmed from fal.ai's own docs: "On a failed COMPLETED request,
    // the response may also include error". A failure is a COMPLETED
    // status that carries an `error` field, not a different status
    // value, so that check has to happen before treating COMPLETED as
    // success.
    if (statusRes.status === "COMPLETED" && statusRes.error) {
      return {
        status: "failed",
        errorCode: "PROVIDER_ERROR",
        errorMessage: statusRes.error,
        raw: statusRes,
      };
    }

    const status = mapFalStatus(statusRes.status);

    if (status !== "succeeded") {
      return { status, raw: statusRes };
    }

    const resultRes = await this.fetchJson<FalResultResponse>(
      "GET",
      `${QUEUE_BASE}/${modelId}/requests/${requestId}`
    );

    const resultUrls = (resultRes.images ?? resultRes.videos ?? [])
      .map((item) => item.url)
      .filter((url): url is string => typeof url === "string");

    return { status, resultUrls, raw: resultRes };
  }

  async cancel(externalTaskId: string): Promise<CancelResult> {
    const { modelId, requestId } = splitTaskId(externalTaskId);

    let res: Response;
    try {
      res = await fetch(`${QUEUE_BASE}/${modelId}/requests/${requestId}/cancel`, {
        method: "PUT",
        headers: { Authorization: `Key ${this.apiKey}` },
      });
    } catch {
      return { ok: false, reason: "provider_error" };
    }

    if (res.status === 202) return { ok: true, status: "cancelled" };
    if (res.status === 400) return { ok: true, status: "already_completed" };
    if (res.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "provider_error" };
  }

  private async fetchJson<T>(
    method: "GET" | "POST",
    url: string,
    body?: unknown
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ProviderAdapterError("fal.ai request failed to send", "TIMEOUT");
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => undefined);

      // Content-policy rejections are confirmed from fal.ai's own
      // errors docs: HTTP 422 with a `detail` array of objects, each
      // carrying `type: "content_policy_violation"`. Checked before
      // falling back to the generic HTTP-status mapping, since 422
      // alone is shared with other validation failures.
      if (res.status === 422 && bodyText) {
        const contentBlockMessage = extractFalContentPolicyMessage(bodyText);
        if (contentBlockMessage) {
          throw new ProviderAdapterError(contentBlockMessage, "CONTENT_BLOCK", bodyText);
        }
      }

      throw new ProviderAdapterError(
        `fal.ai returned HTTP ${res.status}`,
        mapFalHttpStatus(res.status),
        bodyText
      );
    }

    const json = (await res.json().catch(() => null)) as T | null;
    if (json === null) {
      throw new ProviderAdapterError("fal.ai returned a non-JSON response", "PROVIDER_ERROR");
    }
    return json;
  }
}

type FalSubmitResponse = {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  queue_position?: number;
};

type FalStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string;
  request_id: string;
  error?: string;
  error_type?: string;
};

type FalResultResponse = {
  images?: { url: string }[];
  videos?: { url: string }[];
};

function splitTaskId(externalTaskId: string): { modelId: string; requestId: string } {
  const sep = externalTaskId.lastIndexOf("::");
  if (sep === -1) {
    throw new ProviderAdapterError(
      `malformed fal.ai external task id: ${externalTaskId}`,
      "PROVIDER_ERROR"
    );
  }
  return {
    modelId: externalTaskId.slice(0, sep),
    requestId: externalTaskId.slice(sep + 2),
  };
}

function mapFalStatus(status: string): JobStatus {
  switch (status) {
    case "IN_QUEUE":
      return "queued";
    case "IN_PROGRESS":
      return "running";
    case "COMPLETED":
      return "succeeded";
    default:
      return "running";
  }
}

function mapFalHttpStatus(httpStatus: number): ProviderErrorCode {
  if (httpStatus === 401 || httpStatus === 403) return "KEY_INVALID";
  if (httpStatus === 429) return "RATE_LIMIT";
  if (httpStatus >= 500) return "PROVIDER_ERROR";
  return "PROVIDER_ERROR";
}

type FalValidationErrorDetail = {
  type?: string;
  msg?: string;
};

/**
 * Looks for `detail: [{ type: "content_policy_violation", msg }]` in a
 * fal.ai 422 response body, per fal.ai's own documented error schema.
 * Returns the human-readable msg if found, or null if this 422 wasn't
 * a content-policy rejection (some other validation failure, which
 * stays a generic PROVIDER_ERROR rather than being misread as one).
 */
function extractFalContentPolicyMessage(bodyText: string): string | null {
  let parsed: { detail?: FalValidationErrorDetail[] };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }

  const violation = parsed.detail?.find((d) => d.type === "content_policy_violation");
  return violation?.msg ?? null;
}
