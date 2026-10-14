import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Saves a succeeded generate_scene_video job's result into our own
 * storage as a versioned video asset. Plain module (no "server-only")
 * so both the Next.js app and the Trigger.dev runner can call it with
 * their own service-role client. Callers do the auth; this does none.
 *
 * Idempotent: a job whose payload already has savedAssetId returns
 * that id without re-uploading, so the runner, the page-load recovery
 * and the browser's poller can all race on the same job safely (worst
 * case a duplicate download, never a duplicate asset row after the
 * first savedAssetId write).
 */
export async function finalizeSceneVideo(
  service: SupabaseClient,
  jobId: string
): Promise<{ ok: true; assetId: string } | { ok: false; error: string }> {
  const { data: job, error: jobError } = await service
    .from("jobs")
    .select("id, org_id, ad_id, scene_id, kind, status, payload")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return { ok: false, error: jobError?.message ?? "Job not found." };
  if (job.kind !== "generate_scene_video") return { ok: false, error: "Not a scene video job." };
  if (job.status !== "succeeded") return { ok: false, error: "Job has not succeeded." };

  const payload = job.payload as { resultUrls?: string[]; savedAssetId?: string; endpoint?: string };
  if (payload.savedAssetId) return { ok: true, assetId: payload.savedAssetId };

  const resultUrl = payload.resultUrls?.[0];
  if (!resultUrl) return { ok: false, error: "Job succeeded but has no result URL." };
  if (!job.ad_id || !job.scene_id) return { ok: false, error: "Job is missing ad/scene association." };

  const videoRes = await fetch(resultUrl);
  if (!videoRes.ok) return { ok: false, error: `Could not download the generated video (${videoRes.status}).` };
  const videoBytes = await videoRes.arrayBuffer();

  // Re-check right before writing: another caller may have finished first.
  const { data: fresh } = await service.from("jobs").select("payload").eq("id", jobId).maybeSingle();
  const freshSaved = (fresh?.payload as { savedAssetId?: string } | null)?.savedAssetId;
  if (freshSaved) return { ok: true, assetId: freshSaved };

  const { data: existingVersions } = await service
    .from("assets")
    .select("version")
    .eq("org_id", job.org_id)
    .eq("scene_id", job.scene_id)
    .eq("kind", "video")
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existingVersions?.[0]?.version ?? 0) + 1;

  const storagePath = `${job.org_id}/renders/${job.ad_id}/${job.scene_id}/${Date.now()}.mp4`;
  const { error: uploadError } = await service.storage
    .from("renders")
    .upload(storagePath, videoBytes, { contentType: "video/mp4" });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: assetRow, error: assetError } = await service
    .from("assets")
    .insert({
      org_id: job.org_id,
      ad_id: job.ad_id,
      scene_id: job.scene_id,
      kind: "video",
      version: nextVersion,
      storage_path: storagePath,
      source: `${payload.endpoint ?? "unknown"}`,
    })
    .select("id")
    .single();
  if (assetError) return { ok: false, error: assetError.message };

  await service.from("jobs").update({ payload: { ...payload, savedAssetId: assetRow.id } }).eq("id", jobId);
  return { ok: true, assetId: assetRow.id };
}

/**
 * Finds this ad's succeeded scene-video jobs that were never saved
 * (e.g. the tab was closed when they finished) and saves them. Run on
 * Studio page load so a paid result is never left orphaned.
 */
export async function recoverUnsavedSceneVideos(service: SupabaseClient, orgId: string, adId: string): Promise<number> {
  const { data: jobs } = await service
    .from("jobs")
    .select("id, payload")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "generate_scene_video")
    .eq("status", "succeeded");
  type P = { savedAssetId?: string; saveAttempts?: number } | null;
  // Give up after 3 failed tries (e.g. an expired provider URL) so a dead
  // job doesn't slow every page load forever.
  const orphans = (jobs ?? []).filter((j) => {
    const p = j.payload as P;
    return !p?.savedAssetId && (p?.saveAttempts ?? 0) < 3;
  });
  let saved = 0;
  for (const job of orphans) {
    const result = await finalizeSceneVideo(service, job.id);
    if (result.ok) {
      saved += 1;
    } else {
      console.error("recoverUnsavedSceneVideos: could not save job", job.id, result.error);
      const p = (job.payload ?? {}) as Record<string, unknown> & { saveAttempts?: number };
      await service
        .from("jobs")
        .update({ payload: { ...p, saveAttempts: (p.saveAttempts ?? 0) + 1, saveError: result.error } })
        .eq("id", job.id);
    }
  }
  return saved;
}
