/**
 * Shared adapter interface, spec §5.3: "estimate(params), submit(params)
 * returns an external task id, poll(id), normalize(result), cancel(id).
 * Persist the external id before polling." Every provider adapter
 * implements this exact shape so the job runner (M9+) never branches on
 * which provider it's talking to.
 */

export type GenerationKind = "image" | "video";

export type SubmitParams = {
  kind: GenerationKind;
  model: string;
  prompt: string;
  /** Reference image URLs, in priority order (spec §5.6). */
  referenceImageUrls?: string[];
  aspectRatio?: string;
  /** Provider- and model-specific extras, validated against the model's parameter_schema before this call. */
  extra?: Record<string, unknown>;
};

export type EstimateResult = {
  usdEstimate: number;
};

export type SubmitResult = {
  externalTaskId: string;
};

/** The three states every provider's own vocabulary normalizes into. */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type PollResult = {
  status: JobStatus;
  /** Only present once status is "succeeded". */
  resultUrls?: string[];
  /** Only present once status is "failed". */
  errorCode?: ProviderErrorCode;
  errorMessage?: string;
  /** Raw provider payload, kept for debugging/audit — never shown to the end user directly. */
  raw?: unknown;
};

export type CancelResult =
  | { ok: true; status: "cancelled" | "already_completed" }
  | { ok: false; reason: "not_supported" | "not_found" | "provider_error" };

/**
 * Spec §5.10's error vocabulary, the subset an adapter can actually
 * detect from a provider response (SPEND_LIMIT/VALIDATION/PROMPT_LOGIC
 * are decided above the adapter layer, not inside it).
 */
export type ProviderErrorCode =
  | "CONTENT_BLOCK"
  | "PROVIDER_ERROR"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "KEY_INVALID"
  | "KEY_NO_CREDIT";

export interface ProviderAdapter {
  readonly provider: string;

  estimate(params: SubmitParams): Promise<EstimateResult>;

  /** Throws a ProviderAdapterError on failure — never returns a half-submitted result. */
  submit(params: SubmitParams): Promise<SubmitResult>;

  /**
   * Polls the provider and returns an already-normalized result — this
   * folds the spec's separate poll()/normalize() pair into one call,
   * since every caller needs the normalized shape and no caller has a
   * use for raw provider JSON on its own. The raw payload still rides
   * along on PollResult.raw for debugging, so nothing from normalize()
   * is lost, just inlined.
   */
  poll(externalTaskId: string): Promise<PollResult>;

  cancel(externalTaskId: string): Promise<CancelResult>;
}

export class ProviderAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "ProviderAdapterError";
  }
}
