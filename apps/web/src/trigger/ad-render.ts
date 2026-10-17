import { logger, task } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTO_EDIT_MACHINE } from "@/lib/auto-edit/limits";
import { autoEditErrorMessage } from "@/lib/auto-edit/messages";
import { classify } from "@/lib/auto-edit/pipeline";
import { runAdRender } from "@/lib/auto-edit/render-pipeline";
import { autoEditRenderLimit } from "./auto-edit";

/**
 * "Render MP4" and "Export project for..." (lib/auto-edit/render-pipeline.ts)
 * on the same machine and image as Auto-edit, holding the same named
 * concurrency limit, so the per-agency and overall caps count every
 * render-worker job together. Triggered with concurrencyKey = org id.
 */

const MAX_ATTEMPTS = 2;

export type AdRenderPayload = { renderId: string };

export const adRender = task({
  id: "ad-render",
  machine: AUTO_EDIT_MACHINE,
  maxDuration: 1800,
  concurrency: autoEditRenderLimit,
  retry: { maxAttempts: MAX_ATTEMPTS, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000 },
  run: async (payload: AdRenderPayload, { ctx }) => {
    const supabase = getServiceClient();
    await supabase.from("ad_renders").update({ trigger_run_id: ctx.run.id }).eq("id", payload.renderId);
    try {
      return await runAdRender({
        supabase,
        renderId: payload.renderId,
        workRoot: join(tmpdir(), "ad-render"),
        machine: ctx.machine?.name ?? AUTO_EDIT_MACHINE,
        log: (m, extra) => logger.log(m, extra),
      });
    } catch (e) {
      const failure = classify(e);
      logger.error("ad-render failed", { code: failure.code, message: failure.message, attempt: ctx.attempt.number });
      await appendErrorDetail(supabase, payload.renderId, `attempt ${ctx.attempt.number} ${failure.code}: ${failure.message}`);
      if (failure.retryable && ctx.attempt.number < MAX_ATTEMPTS) {
        await supabase.from("ad_renders").update({ error: "Retrying after a render problem." }).eq("id", payload.renderId);
        throw failure;
      }
      await markFailed(supabase, payload.renderId, failure.code, failure.message);
      return { status: "failed" as const };
    }
  },
  onFailure: async ({ payload, error }) => {
    const supabase = getServiceClient();
    const { data } = await supabase.from("ad_renders").select("status").eq("id", payload.renderId).maybeSingle();
    if (data && ["queued", "rendering"].includes(data.status)) {
      const message = error instanceof Error ? error.message : String(error);
      await appendErrorDetail(supabase, payload.renderId, `run failed: ${message}`);
      await markFailed(supabase, payload.renderId, "RENDER_FAILED", message);
    }
  },
});

async function appendErrorDetail(supabase: ReturnType<typeof getServiceClient>, renderId: string, line: string) {
  const { data } = await supabase.from("ad_renders").select("error_detail").eq("id", renderId).maybeSingle();
  const detail = [data?.error_detail, line.slice(0, 4000)].filter(Boolean).join("\n");
  await supabase.from("ad_renders").update({ error_detail: detail }).eq("id", renderId);
}

async function markFailed(supabase: ReturnType<typeof getServiceClient>, renderId: string, code: string, detail: string) {
  // VALIDATION here lists what makes the timeline unrenderable, in plain words.
  const plain = ["SPEND_LIMIT", "AD_NOT_READY", "VALIDATION"].includes(code) ? detail : autoEditErrorMessage(code);
  await supabase
    .from("ad_renders")
    .update({ status: "failed", error_code: code, error: plain, finished_at: new Date().toISOString() })
    .eq("id", renderId);
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("ad-render: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
