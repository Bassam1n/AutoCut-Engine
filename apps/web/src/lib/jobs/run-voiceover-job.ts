"use server";

import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { generateVoiceover } from "@/trigger/generate-voiceover";

/**
 * Entry point for whole-ad voiceover generation (spec §5.4 bullet 5 /
 * §6 M10). Mirrors lib/jobs/run-job.ts's startProviderJob/getJobStatus
 * pattern exactly, but calls request_ad_voiceover() (migration 46)
 * instead of request_scene_regen() — that RPC requires a scene id and
 * can't represent a whole-ad, not-scene-scoped voiceover job — and
 * triggers the separate generate-voiceover task (not run-provider-job,
 * which is built for kie/fal's submit-then-poll shape that ElevenLabs's
 * synchronous TTS/STT calls don't fit).
 */
export type StartVoiceoverJobResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function startAdVoiceoverJob(
  orgId: string,
  adId: string,
  voiceId?: string
): Promise<StartVoiceoverJobResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { data: job, error } = await supabase.rpc("request_ad_voiceover", {
    target_ad_id: adId,
    regen_payload: voiceId ? { voiceId } : {},
  });

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Could not create voiceover job." };
  }

  await tasks.trigger<typeof generateVoiceover>("generate-voiceover", { jobId: job.id });

  return { ok: true, jobId: job.id };
}

export type VoiceoverJobStatusResult =
  | { ok: true; status: string; voAssetId?: string; captionAssetId?: string; error?: string; errorCode?: string }
  | { ok: false; error: string };

/** Reads the jobs row directly, same reasoning as getJobStatus in run-job.ts — cheaper than retrieving the Trigger.dev run, and the DB row is what Realtime/polling already watches. */
export async function getVoiceoverJobStatus(orgId: string, jobId: string): Promise<VoiceoverJobStatusResult> {
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

  const payload = job.payload as { voAssetId?: string; captionAssetId?: string } | null;

  return {
    ok: true,
    status: job.status,
    voAssetId: payload?.voAssetId,
    captionAssetId: payload?.captionAssetId,
    error: job.error ?? undefined,
    errorCode: job.error_code ?? undefined,
  };
}
