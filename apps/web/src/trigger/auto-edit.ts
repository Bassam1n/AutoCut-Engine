import { concurrencyLimit, logger, task } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTO_EDIT_LIMIT_NAME, AUTO_EDIT_MACHINE, AUTO_EDIT_PER_AGENCY_LIMIT, AUTO_EDIT_TOTAL_LIMIT } from "@/lib/auto-edit/limits";
import { autoEditErrorMessage } from "@/lib/auto-edit/messages";
import { classify, runAutoEdit } from "@/lib/auto-edit/pipeline";

/**
 * Auto-edit's render worker: Claude plans the cut, Hyperframes renders
 * the motion graphics and the render engine assembles the video (see
 * lib/auto-edit/pipeline.ts for the steps). Runs on its own machine
 * size and image (trigger.config.ts adds the toolchain), behind one
 * named concurrency limit: perKey caps each agency (triggered with
 * concurrencyKey = org id), total caps every agency together. See
 * lib/auto-edit/limits.ts to raise them.
 *
 * Retries once on a render or network failure; the pipeline skips
 * every Claude step whose result is already stored, so a retry doesn't
 * pay Claude again. Same service-client construction as the other
 * tasks (lib/supabase/service.ts is server-only).
 */

export const autoEditRenderLimit = concurrencyLimit({
  name: AUTO_EDIT_LIMIT_NAME,
  perKey: AUTO_EDIT_PER_AGENCY_LIMIT,
  total: AUTO_EDIT_TOTAL_LIMIT,
});

const MAX_ATTEMPTS = 2;

export type AutoEditPayload = { runId: string };

export const autoEdit = task({
  id: "auto-edit",
  machine: AUTO_EDIT_MACHINE,
  maxDuration: 1800,
  concurrency: autoEditRenderLimit,
  retry: { maxAttempts: MAX_ATTEMPTS, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000 },
  run: async (payload: AutoEditPayload, { ctx }) => {
    const supabase = getServiceClient();
    await supabase.from("auto_edit_runs").update({ trigger_run_id: ctx.run.id }).eq("id", payload.runId);
    try {
      return await runAutoEdit({
        supabase,
        runId: payload.runId,
        workRoot: join(tmpdir(), "auto-edit"),
        machine: ctx.machine?.name ?? AUTO_EDIT_MACHINE,
        log: (m, extra) => logger.log(m, extra),
      });
    } catch (e) {
      const failure = classify(e);
      logger.error("auto-edit failed", { code: failure.code, message: failure.message, attempt: ctx.attempt.number });
      await appendErrorDetail(supabase, payload.runId, `attempt ${ctx.attempt.number} ${failure.code}: ${failure.message}`);
      if (failure.retryable && ctx.attempt.number < MAX_ATTEMPTS) {
        await supabase.from("auto_edit_runs").update({ error: "Retrying after a render problem." }).eq("id", payload.runId);
        throw failure;
      }
      await markFailed(supabase, payload.runId, failure.code, failure.message);
      return { status: "failed" as const };
    }
  },
  // Covers what run() can't catch, such as the time limit.
  onFailure: async ({ payload, error }) => {
    const supabase = getServiceClient();
    const { data } = await supabase.from("auto_edit_runs").select("status").eq("id", payload.runId).maybeSingle();
    if (data && !["succeeded", "failed", "cancelled"].includes(data.status)) {
      const message = error instanceof Error ? error.message : String(error);
      await appendErrorDetail(supabase, payload.runId, `run failed: ${message}`);
      await markFailed(supabase, payload.runId, "RENDER_FAILED", message);
    }
  },
});

async function appendErrorDetail(supabase: ReturnType<typeof getServiceClient>, runId: string, line: string) {
  const { data } = await supabase.from("auto_edit_runs").select("error_detail").eq("id", runId).maybeSingle();
  const detail = [data?.error_detail, line.slice(0, 4000)].filter(Boolean).join("\n");
  await supabase.from("auto_edit_runs").update({ error_detail: detail }).eq("id", runId);
}

async function markFailed(supabase: ReturnType<typeof getServiceClient>, runId: string, code: string, detail: string) {
  // The stored error is what the editor reads; the raw detail goes to the task log.
  const plain = code === "SPEND_LIMIT" || code === "AD_NOT_READY" || code === "NEEDS_HUMAN" ? detail : autoEditErrorMessage(code);
  await supabase
    .from("auto_edit_runs")
    .update({ status: "failed", error_code: code, error: plain, finished_at: new Date().toISOString() })
    .eq("id", runId);
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("auto-edit: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
