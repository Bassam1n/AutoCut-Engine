import { task, wait, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { KieAdapter } from "@/lib/providers/kie";
import { FalAdapter } from "@/lib/providers/fal";
import { ProviderAdapterError, type ProviderAdapter, type SubmitParams } from "@/lib/providers/types";

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
      provider: "fal" | "kie";
      endpoint: string;
      prompt: string;
      referenceImageUrls?: string[];
      aspectRatio?: string;
      extra?: Record<string, unknown>;
      priceUnit: "per_image" | "per_video" | "per_second";
      spendKind: string;
    };

    // Same guard llm.call()/generate-reference-image.ts apply before
    // spending anything — a paused org's job shouldn't be able to
    // reach a real provider call just because it came in through the
    // async runner instead of the inline path.
    const { error: claimError } = await supabase.rpc("claim_paid_job", { target_org_id: jobPayload.orgId });
    if (claimError) {
      await failJob(supabase, job.id, "SPEND_LIMIT", claimError.message);
      return { ok: false };
    }

    const { data: apiKey, error: keyError } = await supabase.rpc("get_org_secret_value", {
      target_org_id: jobPayload.orgId,
      target_provider: jobPayload.provider,
    });

    if (keyError || !apiKey) {
      await failJob(supabase, job.id, "KEY_INVALID", `No ${jobPayload.provider} key saved for this org.`);
      return { ok: false };
    }

    const adapter: ProviderAdapter =
      jobPayload.provider === "kie" ? new KieAdapter(apiKey) : new FalAdapter(apiKey);

    const submitParams: SubmitParams = {
      kind: job.kind === "generate_scene_video" ? "video" : "image",
      model: jobPayload.endpoint,
      prompt: jobPayload.prompt,
      referenceImageUrls: jobPayload.referenceImageUrls,
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
        await adapter.cancel(externalTaskId);
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

    // Priced from price_table (spec §4), same as every other paid call
    // in this app — 0 if a row is ever missing rather than throwing,
    // since a pricing-table gap shouldn't block a successful
    // generation that already happened and cost real money.
    //
    // price_table.usd is a PER-UNIT rate, not a flat charge — for
    // "per_second" rows (e.g. bytedance/seedance-2-5 at $0.19/sec)
    // this must be multiplied by the actual video duration, or every
    // video gets billed as if it were 1 second long regardless of how
    // long it actually ran. This was missed when video pricing units
    // were added in M7: the original (image-only) version of this
    // code only ever dealt with "per_image" rows, where usd IS the
    // flat charge, so `target_usd_est: price?.usd` was correct then
    // and silently wrong the moment "per_second" rows started being
    // used — caught from a real $2.52 kie.ai dashboard charge
    // recording as $0.19 in spend_events (should have been ~$1.26 for
    // a 2-generation session with real durations, still short of
    // $2.52 exactly because kie.ai's own billed seconds don't always
    // match the requested duration param 1:1 — this fix uses the
    // REQUESTED duration as the best available estimate, not kie.ai's
    // actual billed seconds, which this app has no way to read back).
    const { data: price } = await supabase
      .from("price_table")
      .select("usd")
      .eq("provider", jobPayload.provider)
      .eq("model", jobPayload.endpoint)
      .eq("unit", jobPayload.priceUnit)
      .maybeSingle();

    const requestedDurationSeconds = Number(jobPayload.extra?.duration ?? NaN);
    const usdEstimate =
      jobPayload.priceUnit === "per_second" && Number.isFinite(requestedDurationSeconds)
        ? (price?.usd ?? 0) * requestedDurationSeconds
        : (price?.usd ?? 0);

    await supabase.rpc("record_spend_event", {
      target_org_id: jobPayload.orgId,
      target_ad_id: job.ad_id,
      target_provider: jobPayload.provider,
      target_model: jobPayload.endpoint,
      target_usd_est: usdEstimate,
      target_kind: jobPayload.spendKind,
    });

    await supabase
      .from("jobs")
      .update({ status: "succeeded", payload: { ...jobPayload, resultUrls } })
      .eq("id", job.id);

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
