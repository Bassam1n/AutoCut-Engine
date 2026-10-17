import { task, wait, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { KieAdapter } from "@/lib/providers/kie";
import { FalAdapter } from "@/lib/providers/fal";
import { ProviderAdapterError, type ProviderAdapter, type SubmitParams } from "@/lib/providers/types";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { finalizeSceneVideo } from "@/lib/jobs/finalize-scene-video";

/**
 * The minimal durable job runner spec §3/§6 (M7 "done when: a job
 * reloaded mid-render reattaches and completes") and §4's jobs table
 * call for — nothing before this ran outside a single Next.js request,
 * so nothing could survive a closed tab or poll longer than a
 * serverless function's own timeout. This task is the generic
 * submit-then-poll engine: given a jobs.id, it reads the row (written
 * by a server action before triggering), submits to the right
 * provider adapter, polls with wait.for() (which Trigger.dev doesn't
 * bill as compute time past a few seconds — see trigger.config.ts),
 * and writes the result back into the SAME row the browser is already
 * reading via Realtime/polling. One generic task handles every
 * provider job kind (image or video) rather than one task per kind,
 * since the submit/poll/store shape is identical — only the payload
 * and which asset fields get written differ, and this first slice
 * only needs to prove the mechanism, not every kind's full behavior.
 *
 * Deliberately NOT using the Next.js service client
 * (lib/supabase/service.ts) — that file is guarded with
 * `import "server-only"`, a Next.js-bundler-only package that doesn't
 * resolve in a Trigger.dev task process. This constructs the same
 * service-role client directly instead.
 */

type RunProviderJobPayload = {
  jobId: string;
};

export const runProviderJob = task({
  id: "run-provider-job",
  // Video polling can run long (spec §5.7: up to ~20 minutes) — this
  // is a ceiling well above any real job, not a target.
  maxDuration: 1800,
  run: async (payload: RunProviderJobPayload) => {
    const supabase = getServiceClient();

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", payload.jobId)
      .maybeSingle();

    if (jobError || !job) {
      throw new Error(`run-provider-job: jobs row ${payload.jobId} not found (${jobError?.message ?? "no row"})`);
    }

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      // Already terminal — a retry/duplicate trigger for the same job
      // id should be a no-op, not redo paid work. Idempotency key on
      // the jobs table is the primary guard against a duplicate INSERT;
      // this is the secondary guard against a duplicate task run for
      // the row that does exist.
      logger.log("Job already terminal, skipping", { jobId: job.id, status: job.status });
      return { skipped: true, status: job.status };
    }

    await supabase.from("jobs").update({ status: "running" }).eq("id", job.id);

    const jobPayload = job.payload as {
      orgId: string;
      brandId?: string;
      provider: "fal" | "kie";
      endpoint: string;
      prompt: string;
      referenceImageUrls?: string[];
      referenceAudioUrls?: string[];
      aspectRatio?: string;
      extra?: Record<string, unknown>;
      priceUnit: "per_image" | "per_video" | "per_second";
      spendKind: string;
    };

    // Same guard llm.call()/generate-reference-image.ts apply before
    // spending anything — a paused org's job shouldn't be able to
    // reach a real provider call just because it came in through the
    // async runner instead of the inline path.
    const claimError =
      (await supabase.rpc("claim_paid_media_job", { target_org_id: jobPayload.orgId })).error ??
      (jobPayload.brandId
        ? (await supabase.rpc("assert_brand_active", { target_org_id: jobPayload.orgId, target_brand_id: jobPayload.brandId })).error
        : null);
    if (claimError) {
      await failJob(supabase, job.id, "SPEND_LIMIT", spendLimitMessage(claimError.message));
      return { ok: false };
    }

    // Price the job before anything is submitted. A model with no
    // price_table row is refused outright: recording $0 for it would let
    // paid generations run without ever counting toward the org's spend
    // stop. The unit comes from price_table, not from the payload.
    const estimate = await estimateJobUsd(supabase, jobPayload);
    if (!estimate.ok) {
      await failJob(supabase, job.id, "VALIDATION", estimate.error);
      return { ok: false };
    }
    const recordSpend = () =>
      supabase.rpc("record_spend_event", {
        target_org_id: jobPayload.orgId,
        target_ad_id: job.ad_id,
        target_provider: jobPayload.provider,
        target_model: jobPayload.endpoint,
        target_usd_est: estimate.usd,
        target_kind: jobPayload.spendKind,
        target_scene_id: job.scene_id,
      });

    // brandId may be absent on a job queued before this field existed —
    // get_brand_secret_value requires a non-null target_brand_id, so a
    // missing brandId falls back to the plain org-level RPC rather than
    // passing null through (which would fail the brand ownership
    // lookup, not just skip it).
    const { data: apiKey, error: keyError } = jobPayload.brandId
      ? await supabase.rpc("get_brand_secret_value", {
          target_org_id: jobPayload.orgId,
          target_brand_id: jobPayload.brandId,
          target_provider: jobPayload.provider,
        })
      : await supabase.rpc("get_org_secret_value", {
          target_org_id: jobPayload.orgId,
          target_provider: jobPayload.provider,
        });

    if (keyError || !apiKey) {
      await failJob(supabase, job.id, "KEY_INVALID", `No ${jobPayload.provider} key saved for this brand or org.`);
      return { ok: false };
    }

    const adapter: ProviderAdapter =
      jobPayload.provider === "kie" ? new KieAdapter(apiKey) : new FalAdapter(apiKey);

    const submitParams: SubmitParams = {
      kind: job.kind === "generate_scene_video" ? "video" : "image",
      model: jobPayload.endpoint,
      prompt: jobPayload.prompt,
      referenceImageUrls: jobPayload.referenceImageUrls,
      referenceAudioUrls: jobPayload.referenceAudioUrls,
      aspectRatio: jobPayload.aspectRatio,
      extra: jobPayload.extra,
    };

    let externalTaskId: string;
    try {
      const submitResult = await adapter.submit(submitParams);
      externalTaskId = submitResult.externalTaskId;
    } catch (err) {
      const message = err instanceof ProviderAdapterError ? err.message : "Provider submission failed.";
      const code = err instanceof ProviderAdapterError ? err.code : "PROVIDER_ERROR";
      await failJob(supabase, job.id, code, message);
      return { ok: false };
    }

    // External id persisted before polling (spec §4 rule 7) — a job
    // that gets reloaded/re-triggered can check this instead of
    // re-submitting (and re-paying for) a new provider task.
    await supabase.from("jobs").update({ external_task_id: externalTaskId, provider: jobPayload.provider }).eq("id", job.id);

    // 10s rather than 4s: Trigger.dev only treats a wait.for() as free
    // (not billed as compute) once it's over 5 seconds — a 4s poll
    // interval was quietly billing every single poll cycle. 10s is
    // still frequent enough to feel responsive against a multi-minute
    // generation and keeps every wait in the free bucket.
    const POLL_INTERVAL_SECONDS = 10;
    const MAX_POLL_ATTEMPTS = 120; // 120 * 10s = up to 20 minutes, matching spec §5.7's video poll window
    let resultUrls: string[] | undefined;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await wait.for({ seconds: POLL_INTERVAL_SECONDS });

      const { data: current } = await supabase.from("jobs").select("cancel_requested").eq("id", job.id).maybeSingle();
      if (current?.cancel_requested) {
        const cancelResult = await adapter.cancel(externalTaskId);
        // Unless the provider confirms it stopped the task, assume it ran
        // (and was billed) and count it toward the spend stop.
        if (!(cancelResult.ok && cancelResult.status === "cancelled")) await recordSpend();
        await supabase.from("jobs").update({ status: "cancelled" }).eq("id", job.id);
        return { ok: false, cancelled: true };
      }

      let poll;
      try {
        poll = await adapter.poll(externalTaskId);
      } catch (err) {
        const message = err instanceof ProviderAdapterError ? err.message : "Provider poll failed.";
        const code = err instanceof ProviderAdapterError ? err.code : "PROVIDER_ERROR";
        await failJob(supabase, job.id, code, message);
        return { ok: false };
      }

      if (poll.status === "succeeded") {
        resultUrls = poll.resultUrls;
        break;
      }
      if (poll.status === "failed") {
        await failJob(supabase, job.id, poll.errorCode ?? "PROVIDER_ERROR", poll.errorMessage ?? "Generation failed.");
        return { ok: false };
      }
    }

    if (!resultUrls || resultUrls.length === 0) {
      await failJob(supabase, job.id, "TIMEOUT", "Generation timed out.");
      return { ok: false };
    }

    await recordSpend();

    await supabase
      .from("jobs")
      .update({ status: "succeeded", payload: { ...jobPayload, resultUrls } })
      .eq("id", job.id);

    // Save scene videos here, durably, instead of relying on an open
    // browser tab to finalize them (a closed tab used to orphan a paid
    // result). Best effort: the page-load recovery retries on failure.
    if (job.kind === "generate_scene_video") {
      const saved = await finalizeSceneVideo(supabase, job.id);
      if (!saved.ok) logger.error("Scene video not saved; page load will retry", { jobId: job.id, error: saved.error });
    }

    return { ok: true, resultUrls };
  },
});

async function failJob(
  supabase: ReturnType<typeof getServiceClient>,
  jobId: string,
  errorCode: string,
  error: string
): Promise<void> {
  await supabase.from("jobs").update({ status: "failed", error_code: errorCode, error }).eq("id", jobId);
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("run-provider-job: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type PricedPayload = {
  provider: string;
  endpoint: string;
  priceUnit: "per_image" | "per_video" | "per_second";
  extra?: Record<string, unknown>;
};

/**
 * price_table.usd is a PER-UNIT rate, not a flat charge: "per_second"
 * rows are multiplied by the requested duration (the best estimate
 * available; kie.ai's billed seconds can't be read back). The payload's
 * priceUnit only picks between rows when a model has several units.
 */
async function estimateJobUsd(
  supabase: ReturnType<typeof getServiceClient>,
  jobPayload: PricedPayload
): Promise<{ ok: true; usd: number } | { ok: false; error: string }> {
  const { data: rows } = await supabase
    .from("price_table")
    .select("usd, unit")
    .eq("provider", jobPayload.provider)
    .eq("model", jobPayload.endpoint);
  const priced = (rows ?? []).filter((r) => Number(r.usd) > 0);
  const row = priced.find((r) => r.unit === jobPayload.priceUnit) ?? (priced.length === 1 ? priced[0] : undefined);
  if (!row) return { ok: false, error: "This model has no price set yet, so it can't be run. Pick another model." };
  if (row.unit !== "per_second") return { ok: true, usd: Number(row.usd) };
  const seconds = Number(jobPayload.extra?.duration ?? NaN);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) {
    return { ok: false, error: "Invalid video duration." };
  }
  return { ok: true, usd: Number(row.usd) * seconds };
}

