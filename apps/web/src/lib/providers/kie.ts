// No "server-only" guard: this file is pure provider-adapter logic
// (no secrets read directly — the API key is a constructor param from
// the caller) and is imported from both Next.js server code and
// Trigger.dev tasks (src/trigger/), which run outside Next's
// bundler and can't resolve the Next-specific "server-only" package.
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
    // Confirmed from real kie.ai request payloads (user-pasted curl
    // examples, 2026-10-12 — NOT Trench's config data, which has
    // already been caught wrong twice: it guessed singular
    // `image_url` for kling-3.0/video and bytedance/seedance-2, and
    // both turned out to require `reference_image_urls`/`image_urls`
    // respectively once the real payload was checked):
    //   - z-image, google/nano-banana, grok-imagine/image-to-image,
    //     kling-2.6/image-to-video, kling-3.0/video, gemini-omni-video
    //     all use `image_urls` (plural array) — this is the default.
    //   - bytedance/seedance-2 and bytedance/seedance-2-5 both use
    //     `reference_image_urls` instead.
    //   - minimax-h3/image-to-video is different in kind, not just
    //     name: a single `first_frame_url` string (plus an optional
    //     `last_frame_url` for genuine start/end frame support — not
    //     wired up yet, scene-videos-actions.ts explicitly defers
    //     start/end frame mode until a model confirms support, and
    //     now one has; revisit there, not here).
    // Every other kie.ai video model in the registry (v3-api,
    // veo3_lite, veo3_quality) has NO confirmed payload yet — left on
    // the `image_urls` default rather than guessing further, exactly
    // the discipline that caught the two models above being wrong.
    let referenceImageField = "image_urls";
    if (params.model === "bytedance/seedance-2" || params.model === "bytedance/seedance-2-5") {
      referenceImageField = "reference_image_urls";
    } else if (params.model === "minimax-h3/image-to-video") {
      referenceImageField = "first_frame_url";
    }

    const referenceImageValue =
      referenceImageField === "first_frame_url"
        ? params.referenceImageUrls?.[0]
        : params.referenceImageUrls;

    // Reference audio ("use reference audio while creating the
    // video" — per-scene ElevenLabs voiceover clip fed into video
    // generation). Confirmed in this project's own payload testing
    // for exactly these 3 kie.ai video models under the field name
    // `reference_audio_urls` (plural array, same shape as
    // reference_image_urls): bytedance/seedance-2,
    // bytedance/seedance-2-5, kling-3.0/video. Every other model —
    // image models included — has no confirmed reference-audio field
    // at all, so this is a no-op for them: the field is simply never
    // added to the body, never guessed as a universal parameter the
    // way referenceImageUrls's own `image_urls` default behaves.
    const REFERENCE_AUDIO_MODELS = new Set([
      "bytedance/seedance-2",
      "bytedance/seedance-2-5",
      "kling-3.0/video",
    ]);
    const referenceAudioValue =
      REFERENCE_AUDIO_MODELS.has(params.model) && params.referenceAudioUrls?.length
        ? params.referenceAudioUrls
        : undefined;

    const body: Record<string, unknown> = {
      model: params.model,
      input: {
        prompt: params.prompt,
        ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        ...(referenceImageValue ? { [referenceImageField]: referenceImageValue } : {}),
        ...(referenceAudioValue ? { reference_audio_urls: referenceAudioValue } : {}),
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
  //
  // 422 is confirmed to exist but its exact meaning (content policy vs.
  // a generic validation failure) is NOT documented anywhere fetched
  // for this adapter. Deliberately left as PROVIDER_ERROR rather than
  // CONTENT_BLOCK: if 422 turns out to mean something other than a
  // content-filter rejection, mapping it to CONTENT_BLOCK would make
  // submitWithContentBlockReword() burn a reword attempt (and the
  // user's trust) on an error a prompt rewrite can never fix. Revisit
  // once a live 422 response has actually been captured and inspected.
  switch (code) {
    case 401:
      return "KEY_INVALID";
    case 402:
      return "KEY_NO_CREDIT";
    default:
      return "PROVIDER_ERROR";
  }
}
