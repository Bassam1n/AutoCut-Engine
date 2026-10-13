"use server";

import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { runProviderJob } from "@/trigger/run-provider-job";

/**
 * The durable async job runner's entry point — spec §3 "Execution
 * path: UI action, then server action calls an RPC that inserts a
 * jobs row, then the workflow engine receives an event and runs
 * steps." request_scene_regen() is the existing RPC (migration
 * 00000000000014) that inserts the jobs row under RLS; this just adds
 * the "then trigger the workflow engine" half, which nothing called
 * until now.
 *
 * First real caller: Scene videos (spec §5.7), which needs a job that
 * survives a tab close and can poll for up to ~20 minutes — well past
 * what the inline submit-then-poll pattern (generate-reference-
 * image.ts) can do inside one Vercel function invocation. Scene
 * images intentionally keeps using the inline pattern for now; moving
 * it onto this runner is a separate decision, not bundled into this
 * change.
 */
export type RunJobPayload = {
  orgId: string;
  brandId: string;
  provider: "fal" | "kie";
  endpoint: string;
  prompt: string;
  referenceImageUrls?: string[];
  /** Per-scene voiceover clip's signed URL, fed to kie.ai as `reference_audio_urls` for the 3 confirmed models only (see KieAdapter.submit()) — optional, never a hard dependency on video generation. */
  referenceAudioUrls?: string[];
  aspectRatio?: string;
  extra?: Record<string, unknown>;
  priceUnit: "per_image" | "per_video" | "per_second";
  spendKind: string;
};

export type RunJobResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function startProviderJob(
  orgId: string,
  sceneId: string,
  kind: string,
  payload: RunJobPayload
): Promise<RunJobResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { data: job, error } = await supabase.rpc("request_scene_regen", {
    target_scene_id: sceneId,
    regen_kind: kind,
    regen_payload: payload,
  });

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Could not create job." };
  }

  await tasks.trigger<typeof runProviderJob>("run-provider-job", { jobId: job.id });

  return { ok: true, jobId: job.id };
}

export type JobStatusResult =
  | { ok: true; status: string; resultUrls?: string[]; error?: string; errorCode?: string }
  | { ok: false; error: string };

/** Reads the jobs row directly (RLS-readable by any org member) — cheaper and simpler than retrieving the Trigger.dev run for a status the DB already has. */
export async function getJobStatus(orgId: string, jobId: string): Promise<JobStatusResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("status, payload, error, error_code")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found." };
  }

  const payload = job.payload as { resultUrls?: string[] } | null;

  return {
    ok: true,
    status: job.status,
    resultUrls: payload?.resultUrls,
    error: job.error ?? undefined,
    errorCode: job.error_code ?? undefined,
  };
}
