// No "server-only" guard: imported from Trigger.dev tasks too.
import type { CancelResult, EstimateResult, JobStatus, PollResult, ProviderAdapter, SubmitParams, SubmitResult } from "./types";
import { ProviderAdapterError } from "./types";
import {
  HiggsfieldPlanError,
  callMcpTool,
  needsRefresh,
  refreshTokens,
  type HiggsfieldPlanTokens,
  type McpToolResult,
} from "./higgsfield-plan";

/**
 * Per-model mapping for generation through a connected higgsfield.ai
 * account (plan credits), via Higgsfield's MCP tools generate_image /
 * generate_video. The endpoint stored in model_providers is Higgsfield's
 * model id. Media roles and parameters follow Higgsfield's own model
 * reference (github.com/higgsfield-ai/skills, higgsfield-generate
 * references, MIT); values Higgsfield doesn't accept are coerced by its
 * server ("adjustments"), not rejected.
 */
type PlanModelSpec = {
  kind: "image" | "video";
  /** Media role for reference images / the start frame; absent = prompt-only model. */
  role?: string;
  maxImages?: number;
  /** extra keys passed through as model params. */
  allowed: string[];
  integers?: string[];
};

export const HIGGSFIELD_PLAN_MODELS: Record<string, PlanModelSpec> = {
  marketing_studio_image: { kind: "image", role: "image", maxImages: 8, allowed: ["quality", "resolution"] },
  gpt_image_2_5: { kind: "image", role: "image_references", maxImages: 8, allowed: ["quality", "resolution"] },
  soul_2: { kind: "image", allowed: ["quality"] },
  seedance_2_5: { kind: "video", role: "start_image", maxImages: 1, allowed: ["duration", "resolution"], integers: ["duration"] },
  kling3_0: { kind: "video", role: "start_image", maxImages: 1, allowed: ["duration", "sound", "mode"], integers: ["duration"] },
  kling3_0_turbo: { kind: "video", role: "start_image", maxImages: 1, allowed: ["duration", "resolution"], integers: ["duration"] },
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MEDIA_URL_RE = /https:\/\/[^\s"'<>)\]]+\.(?:png|jpe?g|webp|mp4|mov|webm)(?:\?[^\s"'<>)\]]*)?/gi;

export class HiggsfieldPlanAdapter implements ProviderAdapter {
  readonly provider = "higgsfield_plan";
  private tokens: HiggsfieldPlanTokens;

  /**
   * @param secret the stored "higgsfield_plan" secret (JSON tokens)
   * @param persist saves refreshed tokens; refresh tokens can rotate, so
   *   a refreshed login must be written back or the next job can't sign in.
   */
  constructor(secret: string, private readonly persist?: (secret: string) => Promise<void>) {
    try {
      this.tokens = JSON.parse(secret) as HiggsfieldPlanTokens;
    } catch {
      throw new ProviderAdapterError("The saved Higgsfield login is unreadable. Connect the account again.", "KEY_INVALID");
    }
  }

  async estimate(): Promise<EstimateResult> {
    // Plan generations spend the client's own Higgsfield credits; how
    // they count toward AutoCut's dollar spend stop is still undecided.
    return { usdEstimate: 0 };
  }

  async submit(params: SubmitParams): Promise<SubmitResult> {
    const spec = HIGGSFIELD_PLAN_MODELS[params.model];
    if (!spec) throw new ProviderAdapterError(`Higgsfield model ${params.model} is not supported yet.`, "PROVIDER_ERROR");

    const refs = spec.role ? (params.referenceImageUrls ?? []).slice(0, spec.maxImages ?? 1) : [];
    if (spec.kind === "video" && refs.length === 0) {
      throw new ProviderAdapterError("This Higgsfield video model needs a starting image.", "PROVIDER_ERROR");
    }
    // Higgsfield generation takes its own media ids, not URLs.
    const mediaIds = await Promise.all(refs.map((url) => this.importMedia(url)));

    const tool = spec.kind === "video" ? "generate_video" : "generate_image";
    const result = await this.call(tool, {
      params: buildPlanParams(params, spec, mediaIds),
      context: "Generating a scene for a short video ad in AutoCut.",
    });
    if (result.isError) throw toAdapterError(result.text);

    const jobId = parseSubmittedJobId(result.text);
    if (!jobId) throw new ProviderAdapterError("Higgsfield didn't return a job id.", "PROVIDER_ERROR", result.text);
    return { externalTaskId: jobId };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const result = await this.call("job_status", { jobId: externalTaskId });
    if (result.isError) throw toAdapterError(result.text);
    return parseJobStatus(result.text, externalTaskId);
  }

  async cancel(): Promise<CancelResult> {
    // No cancel tool is exposed for generations; the job keeps running
    // and is counted as spent.
    return { ok: false, reason: "not_supported" };
  }

  private async importMedia(url: string): Promise<string> {
    const result = await this.call("media_import_url", { url, type: "image" });
    const id = result.isError ? null : result.text.match(new RegExp(UUID, "i"))?.[0];
    if (!id) throw new ProviderAdapterError("Higgsfield couldn't import a reference image.", "PROVIDER_ERROR", result.text);
    return id;
  }

  /** Calls a tool with a fresh token, refreshing once more on a 401. */
  private async call(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (needsRefresh(this.tokens)) await this.refresh();
    try {
      return await callMcpTool(this.tokens.accessToken, name, args);
    } catch (err) {
      if (err instanceof HiggsfieldPlanError && err.message.includes("401")) {
        await this.refresh();
        try {
          return await callMcpTool(this.tokens.accessToken, name, args);
        } catch (retryErr) {
          throw wrap(retryErr);
        }
      }
      throw wrap(err);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.tokens = await refreshTokens(this.tokens);
    } catch {
      throw new ProviderAdapterError("The Higgsfield login expired. Reconnect the account on the brand's Keys page.", "KEY_INVALID");
    }
    await this.persist?.(JSON.stringify(this.tokens));
  }
}

/** The generate_* `params` object. Exported for tests. */
export function buildPlanParams(params: SubmitParams, spec: PlanModelSpec, mediaIds: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    count: 1,
    // Pay from plan credits; leaving it unset can return a question
    // about free-trial generations instead of submitting.
    use_unlim: false,
  };
  if (params.aspectRatio) out.aspect_ratio = params.aspectRatio;
  if (spec.role && mediaIds.length > 0) out.medias = mediaIds.map((value) => ({ value, role: spec.role }));
  for (const [key, raw] of Object.entries(params.extra ?? {})) {
    if (!spec.allowed.includes(key) || raw === undefined || raw === null) continue;
    let value: unknown = raw;
    if (spec.integers?.includes(key)) {
      value = Math.round(Number(raw));
      if (!Number.isFinite(value)) continue;
    }
    if (key === "sound" && typeof value === "boolean") value = value ? "on" : "off";
    out[key] = value;
  }
  return out;
}

/** The job id from generate_*'s "Submitted 1 job … - <id> "prompt"" text. Exported for tests. */
export function parseSubmittedJobId(text: string): string | null {
  return text.match(new RegExp(`^\\s*-\\s*(${UUID})`, "im"))?.[1] ?? text.match(new RegExp(UUID, "i"))?.[0] ?? null;
}

/** job_status text ("Job <id> — completed" + result URLs) to a PollResult. Exported for tests. */
export function parseJobStatus(text: string, jobId: string): PollResult {
  const state = text.match(new RegExp(`Job\\s+${jobId}\\s*[—-]+\\s*([a-z_]+)`, "i"))?.[1]?.toLowerCase() ?? "";
  const status = mapState(state);
  if (status === "succeeded") {
    // Video files first: a video job can also list a thumbnail image,
    // and callers take resultUrls[0].
    const urls = [...new Set(text.match(MEDIA_URL_RE) ?? [])].sort(
      (a, b) => Number(/\.(mp4|mov|webm)/i.test(b)) - Number(/\.(mp4|mov|webm)/i.test(a))
    );
    if (urls.length === 0) return { status: "running", raw: text };
    return { status, resultUrls: urls, raw: text };
  }
  if (status === "failed") {
    return {
      status,
      errorCode: state === "nsfw" ? "CONTENT_BLOCK" : "PROVIDER_ERROR",
      errorMessage: state === "nsfw" ? "Higgsfield's moderation rejected this prompt or image." : `Higgsfield generation ${state || "failed"}.`,
      raw: text,
    };
  }
  return { status, raw: text };
}

function mapState(state: string): JobStatus {
  if (state === "completed") return "succeeded";
  if (["failed", "nsfw", "canceled", "cancelled", "error"].includes(state)) return "failed";
  if (state === "queued" || state === "pending") return "queued";
  return "running";
}

function toAdapterError(text: string): ProviderAdapterError {
  const lower = text.toLowerCase();
  if (/insufficient|not enough credits|out of credits|top.?up/.test(lower)) {
    return new ProviderAdapterError("The connected Higgsfield account is out of credits.", "KEY_NO_CREDIT", text);
  }
  if (/nsfw|moderation|content policy/.test(lower)) {
    return new ProviderAdapterError("Higgsfield's moderation rejected this prompt or image.", "CONTENT_BLOCK", text);
  }
  if (/concurren|rate limit|too many/.test(lower)) {
    return new ProviderAdapterError("Higgsfield is busy with this account's other generations. Try again shortly.", "RATE_LIMIT", text);
  }
  return new ProviderAdapterError(`Higgsfield: ${text.slice(0, 300)}`, "PROVIDER_ERROR", text);
}

function wrap(err: unknown): ProviderAdapterError {
  if (err instanceof ProviderAdapterError) return err;
  if (err instanceof HiggsfieldPlanError) {
    return new ProviderAdapterError(err.message, err.message.includes("401") ? "KEY_INVALID" : "PROVIDER_ERROR", err.detail);
  }
  return new ProviderAdapterError("Could not reach Higgsfield.", "TIMEOUT");
}
