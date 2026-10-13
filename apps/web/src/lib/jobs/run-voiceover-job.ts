"use server";

import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { generateVoiceover } from "@/trigger/generate-voiceover";

/**
 * Entry point for PER-SCENE voiceover generation (spec §5.4 bullet 5 /
 * §5.11 bullet 5). Reuses request_scene_regen() (migration 14) — the
 * same scene-scoped job-creation RPC Scene images and Scene videos
 * already use — rather than adding a new RPC.
 *
 * Why reuse, not a new RPC: request_scene_regen's signature is
 * (target_scene_id, regen_kind, regen_payload jsonb). regen_payload is
 * arbitrary jsonb with no schema constraint on its shape, so
 * {voiceId, script} fits exactly the same way {orgId, provider,
 * endpoint, prompt, ...} already does for generate_scene_video. The
 * RPC's only real job — verify org membership from the scene id,
 * resolve org_id/ad_id, insert a jobs row with a fresh idempotency
 * key — is identical for a voiceover request. The one thing checked
 * for a genuine gap: does it carry scene_id? Yes — target_scene_id is
 * the RPC's own first argument, and it writes jobs.scene_id directly.
 * There is no concrete gap request_scene_regen can't cover, so no new
 * migration was added (migration 46's now-unused request_ad_voiceover
 * stays in place, untouched, as dead-but-harmless schema per the
 * task's own instruction not to edit a shipped migration).
 */
export type StartVoiceoverJobResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function startSceneVoiceoverJob(
  orgId: string,
  sceneId: string,
  voiceId: string,
  script: string
): Promise<StartVoiceoverJobResult> {
  await requireOrgMember(orgId);

  const trimmedScript = script.trim();
  if (!trimmedScript) {
    return { ok: false, error: "Script is empty." };
  }
  if (!voiceId) {
    return { ok: false, error: "Pick a voice first." };
  }

  const supabase = await createClient();
  const { data: job, error } = await supabase.rpc("request_scene_regen", {
    target_scene_id: sceneId,
    regen_kind: "generate_scene_voiceover",
    regen_payload: { voiceId, script: trimmedScript },
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
