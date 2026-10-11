import "server-only";
import type {
  ProviderAdapter,
  SubmitParams,
  EstimateResult,
  SubmitResult,
  PollResult,
  CancelResult,
  JobStatus,
} from "./types";
import { ProviderAdapterError } from "./types";

const BASE_URL = "https://api.kie.ai/api/v1";

/**
 * kie.ai adapter. Contract confirmed against docs.kie.ai before writing
 * this (not guessed): POST /jobs/createTask, GET /jobs/recordInfo. Every
 * response — success AND failure — comes back as HTTP 200 with a `code`
 * field in the body; `code !== 200` is the real failure signal, not the
 * HTTP status. `data.resultJson` on a successful task is itself a JSON
 * STRING that needs a second parse, not a native object — this is the
 * adapter's job to hide from every caller.
 *
 * No cancel endpoint is documented for kie.ai — cancel() always returns
 * not_supported rather than guessing at an unconfirmed endpoint.
 */
export class KieAdapter implements ProviderAdapter {
  readonly provider = "kie";

  constructor(private readonly apiKey: string) {}

  async estimate(params: SubmitParams): Promise<EstimateResult> {
    void params;
    // kie.ai's own pricing isn't queryable per-call from its API (the
    // only cost-facing endpoint is the account-wide credit balance,
    // confirmed in 00000000000023's verification work) — cost comes
    // from price_table (spec §4), keyed by provider+model, not from
    // this adapter. This estimate is a placeholder the caller is
    // expected to override with a price_table lookup; it never reaches
    // a user-facing price directly.
    return { usdEstimate: 0 };
  }

  async submit(params: SubmitParams): Promise<SubmitResult> {
    const body: Record<string, unknown> = {
      model: params.model,
      input: {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio ?? "9:16",
        ...params.extra,
      },
    };

    const res = await this.request("POST", "/jobs/createTask", body);
    const taskId = (res as { data?: { taskId?: string } }).data?.taskId;

    if (!taskId) {
      throw new ProviderAdapterError(
        "kie.ai createTask response had no data.taskId",
        "PROVIDER_ERROR",
        res
      );
    }

    return { externalTaskId: taskId };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const res = await this.request(
      "GET",
      `/jobs/recordInfo?taskId=${encodeURIComponent(externalTaskId)}`
    );

    const data = (res as { data?: KieRecordInfoData }).data;
    if (!data) {
      throw new ProviderAdapterError(
        "kie.ai recordInfo response had no data",
        "PROVIDER_ERROR",
        res
      );
    }

    const status = mapKieState(data.state);

    if (status === "failed") {
      return {
        status,
        errorCode: mapKieFailCode(data.failCode),
        errorMessage: data.failMsg,
        raw: res,
      };
    }

    if (status === "succeeded") {
      const resultUrls = parseKieResultUrls(data.resultJson);
      return { status, resultUrls, raw: res };
    }

    return { status, raw: res };
  }

  async cancel(externalTaskId: string): Promise<CancelResult> {
    void externalTaskId;
    return { ok: false, reason: "not_supported" };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ProviderAdapterError("kie.ai request failed to send", "TIMEOUT");
    }

    const json = (await res.json().catch(() => null)) as KieEnvelope | null;

    if (!json) {
      throw new ProviderAdapterError(
        `kie.ai returned a non-JSON response (HTTP ${res.status})`,
        "PROVIDER_ERROR"
      );
    }

    if (json.code === 200) return json;

    throw new ProviderAdapterError(
      json.msg ?? `kie.ai error code ${json.code}`,
      mapKieErrorCode(json.code),
      json
    );
  }
}

type KieEnvelope = {
  code: number;
  msg?: string;
  data?: unknown;
};

type KieRecordInfoData = {
  taskId: string;
  state: "waiting" | "queuing" | "generating" | "success" | "fail" | string;
  resultJson?: string | null;
  failCode?: string;
  failMsg?: string;
};

function mapKieState(state: string): JobStatus {
  switch (state) {
    case "waiting":
    case "queuing":
      return "queued";
    case "generating":
      return "running";
    case "success":
      return "succeeded";
    case "fail":
      return "failed";
    default:
      // An undocumented state is treated as still running rather than
      // silently succeeded/failed — the caller keeps polling instead
      // of acting on an unknown state as if it were terminal.
      return "running";
  }
}

function parseKieResultUrls(resultJson: string | null | undefined): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
    return parsed.resultUrls ?? [];
  } catch {
    return [];
  }
}

function mapKieFailCode(failCode: string | undefined): "PROVIDER_ERROR" {
  // kie.ai's documented failCode values aren't mapped to the spend/key/
  // content-block vocabulary anywhere in the docs fetched for this
  // adapter — every failure surfaces as PROVIDER_ERROR with the raw
  // failMsg attached, rather than guessing a finer-grained code.
  void failCode;
  return "PROVIDER_ERROR";
}

function mapKieErrorCode(code: number): import("./types").ProviderErrorCode {
  // Only 401, 402, 422 and 500 are documented on docs.kie.ai's Common
  // API page (confirmed before writing this, not guessed) — no rate
  // -limit code is listed anywhere fetched for this adapter, so an
  // unrecognized code (429 included) falls through to PROVIDER_ERROR
  // rather than assuming it means rate limiting.
  switch (code) {
    case 401:
      return "KEY_INVALID";
    case 402:
      return "KEY_NO_CREDIT";
    default:
      return "PROVIDER_ERROR";
  }
}
