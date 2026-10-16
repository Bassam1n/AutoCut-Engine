import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { groupWordsIntoCues, cuesToSrt, type TimestampedWord } from "@/lib/captions/srt";
import { spendLimitMessage } from "@/lib/spend-limit-message";

/**
 * Voiceover redo (spec §5.4 bullet 5 / §5.11 bullet 5 — "Voiceover and
 * captions"). This is now PER-SCENE, not whole-ad: one ElevenLabs TTS
 * call per speaking scene, each producing its own `vo` asset and its
 * own `caption` asset, both scoped with a real `scene_id` (the prior
 * pass left scene_id null — a whole-ad job that could never feed
 * per-scene reference audio into video generation, which is exactly
 * what the user asked for and the prior pass didn't build).
 *
 * The job this task runs against is created by request_scene_regen()
 * (migration 14) — the same scene-scoped RPC Scene images/videos
 * already use — with kind='generate_scene_voiceover' and a payload of
 * {voiceId, script}. No new RPC: request_scene_regen already takes an
 * arbitrary jsonb payload and already resolves org_id/ad_id from the
 * scene id, which is everything a per-scene voiceover job needs. See
 * run-voiceover-job.ts's docblock for the fuller "why not a new RPC"
 * reasoning.
 *
 * `script` is whatever the editor submitted from the voiceover step's
 * editable textarea — NOT necessarily scene.copy verbatim (the editor
 * can add emotion tags, rephrase, etc). This task trusts the payload's
 * script exactly as given; it never re-reads or substitutes
 * scene.copy itself.
 *
 * Still deliberately NOT built on run-provider-job.ts's ProviderAdapter/
 * SubmitParams/PollResult shape — see the prior version of this
 * docblock's reasoning, unchanged: ElevenLabs's TTS and STT endpoints
 * are both plain synchronous HTTP calls with no external task id to
 * poll, so forcing them through submit()/poll() would mean inventing a
 * fake poll loop for an API that was never asynchronous.
 *
 * Service-role Supabase client constructed the same way
 * run-provider-job.ts does — not via lib/supabase/service.ts, which is
 * guarded by `import "server-only"` and doesn't resolve inside a
 * Trigger.dev task process.
 */

type GenerateVoiceoverPayload = {
  jobId: string;
};

const ELEVENLABS_TTS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_STT_MODEL = "scribe_v2";

export const generateVoiceover = task({
  id: "generate-voiceover",
  // TTS + STT run sequentially against one scene's line — generous
  // ceiling, not a target, matching run-provider-job.ts's own
  // reasoning for its maxDuration.
  maxDuration: 180,
  run: async (payload: GenerateVoiceoverPayload) => {
    const supabase = getServiceClient();

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", payload.jobId)
      .maybeSingle();

    if (jobError || !job) {
      throw new Error(`generate-voiceover: jobs row ${payload.jobId} not found (${jobError?.message ?? "no row"})`);
    }

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      logger.log("Job already terminal, skipping", { jobId: job.id, status: job.status });
      return { skipped: true, status: job.status };
    }

    if (!job.ad_id || !job.scene_id) {
      await failJob(supabase, job.id, "VALIDATION", "Voiceover job has no scene association.");
      return { ok: false };
    }

    await supabase.from("jobs").update({ status: "running" }).eq("id", job.id);

    const { data: ad, error: adError } = await supabase
      .from("ads")
      .select("id, org_id, brand_id")
      .eq("id", job.ad_id)
      .maybeSingle();
    if (adError || !ad) {
      await failJob(supabase, job.id, "VALIDATION", "Ad not found.");
      return { ok: false };
    }

    const jobPayload = (job.payload ?? {}) as { voiceId?: unknown; script?: unknown };
    const voiceId = typeof jobPayload.voiceId === "string" ? jobPayload.voiceId : null;
    const script = typeof jobPayload.script === "string" ? jobPayload.script.trim() : "";

    if (!voiceId) {
      await failJob(supabase, job.id, "VALIDATION", "No voice selected for this voiceover job.");
      return { ok: false };
    }
    if (!script) {
      await failJob(supabase, job.id, "VALIDATION", "No script text to voice.");
      return { ok: false };
    }

    // Same spend guard every other paid call in this app goes through
    // (claim_paid_job) before any real provider cost is incurred.
    const { error: claimError } = await supabase.rpc("claim_paid_media_job", { target_org_id: ad.org_id });
    if (claimError) {
      await failJob(supabase, job.id, "SPEND_LIMIT", spendLimitMessage(claimError.message));
      return { ok: false };
    }

    // ads.brand_id is required (not nullable — see
    // 00000000000006_brands_products.sql), so unlike run-provider-job.ts
    // this always has a brand to resolve a brand-level key for; no
    // org-only fallback branch is needed here the way that file needs
    // one for a job queued before brandId existed on its payload.
    const { data: apiKey, error: keyError } = await supabase.rpc("get_brand_secret_value", {
      target_org_id: ad.org_id,
      target_brand_id: ad.brand_id,
      target_provider: "elevenlabs",
    });
    if (keyError || !apiKey) {
      await failJob(supabase, job.id, "KEY_INVALID", "No elevenlabs key saved for this brand or org.");
      return { ok: false };
    }

    // --- 1. TTS: one call for this scene's (editor-edited) script. ---
    let audioBytes: ArrayBuffer;
    try {
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: script,
          model_id: ELEVENLABS_TTS_MODEL,
        }),
      });
      if (!ttsRes.ok) {
        const bodyText = await ttsRes.text().catch(() => "");
        await failJob(supabase, job.id, "PROVIDER_ERROR", `ElevenLabs TTS failed (${ttsRes.status}): ${bodyText.slice(0, 300)}`);
        return { ok: false };
      }
      // Response 200 is raw audio bytes, never JSON — must not be
      // JSON-parsed.
      audioBytes = await ttsRes.arrayBuffer();
    } catch (err) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", describeError(err, "ElevenLabs TTS request failed."));
      return { ok: false };
    }

    const audioStoragePath = `${ad.org_id}/renders/${job.ad_id}/${job.scene_id}/vo/${Date.now()}.mp3`;
    const { error: audioUploadError } = await supabase.storage
      .from("renders")
      .upload(audioStoragePath, audioBytes, { contentType: "audio/mpeg" });
    if (audioUploadError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", audioUploadError.message);
      return { ok: false };
    }

    // Versioned asset, same pattern finalizeSceneVideoJob/generate-
    // reference-image.ts use for images and videos: compute the next
    // version from this scene+kind's existing rows, never overwrite —
    // editing the script and regenerating creates a NEW version, the
    // old one stays (archived, never deleted).
    const { data: existingVoVersions } = await supabase
      .from("assets")
      .select("version")
      .eq("org_id", ad.org_id)
      .eq("scene_id", job.scene_id)
      .eq("kind", "vo")
      .order("version", { ascending: false })
      .limit(1);
    const nextVoVersion = (existingVoVersions?.[0]?.version ?? 0) + 1;

    const { data: voAssetRow, error: voAssetError } = await supabase
      .from("assets")
      .insert({
        org_id: ad.org_id,
        ad_id: job.ad_id,
        scene_id: job.scene_id,
        kind: "vo",
        version: nextVoVersion,
        storage_path: audioStoragePath,
        source: `elevenlabs:${ELEVENLABS_TTS_MODEL}`,
        meta: { voiceId, script },
      })
      .select("id")
      .single();
    if (voAssetError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", voAssetError.message);
      return { ok: false };
    }

    // Mirrors scene-images-actions.ts's own rule (spec §5.8): a new
    // voiceover take means any video built from the OLD reference
    // audio is now stale — archived (never deleted) rather than left
    // looking current. Restorable via the same "archived videos"
    // strip (scene-videos-step.tsx) the image-regen rule already uses.
    await supabase
      .from("assets")
      .update({ archived: true })
      .eq("org_id", ad.org_id)
      .eq("scene_id", job.scene_id)
      .eq("kind", "video")
      .eq("archived", false);

    // price_table has no confirmed elevenlabs row (same honest gap as
    // the prior pass — no documented per-character TTS price was
    // found to seed one from). record_spend_event still runs so the
    // real event is durably logged, just at $0 until a real price is
    // confirmed and seeded.
    const { data: ttsPrice } = await supabase
      .from("price_table")
      .select("usd")
      .eq("provider", "elevenlabs")
      .eq("model", ELEVENLABS_TTS_MODEL)
      .eq("unit", "per_character")
      .maybeSingle();

    await supabase.rpc("record_spend_event", {
      target_org_id: ad.org_id,
      target_ad_id: job.ad_id,
      target_provider: "elevenlabs",
      target_model: ELEVENLABS_TTS_MODEL,
      target_usd_est: (ttsPrice?.usd ?? 0) * script.length,
      target_kind: "voiceover:tts",
      target_scene_id: job.scene_id,
    });

    // --- 2. STT: word-level timestamps on the audio just generated. ---
    let sttResult: {
      words: { text: string; start: number; end: number; type: string }[];
    };
    try {
      const form = new FormData();
      form.append("model_id", ELEVENLABS_STT_MODEL);
      form.append("timestamps_granularity", "word");
      form.append("file", new Blob([audioBytes], { type: "audio/mpeg" }), "voiceover.mp3");

      const sttRes = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      });
      if (!sttRes.ok) {
        const bodyText = await sttRes.text().catch(() => "");
        await failJob(supabase, job.id, "PROVIDER_ERROR", `ElevenLabs STT failed (${sttRes.status}): ${bodyText.slice(0, 300)}`);
        return { ok: false };
      }
      sttResult = await sttRes.json();
    } catch (err) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", describeError(err, "ElevenLabs STT request failed."));
      return { ok: false };
    }

    // Caption content only ever comes from type === "word" entries —
    // STT's words[] array also includes "spacing" and "audio_event"
    // entries, neither of which carries real caption text.
    const timestampedWords: TimestampedWord[] = sttResult.words
      .filter((w) => w.type === "word")
      .map((w) => ({ text: w.text, start: w.start, end: w.end }));

    if (timestampedWords.length === 0) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", "Speech-to-text returned no word-level timestamps.");
      return { ok: false };
    }

    // --- 3. SRT export, grouped from word timestamps. ---
    const cues = groupWordsIntoCues(timestampedWords);
    const srtText = cuesToSrt(cues);

    const srtStoragePath = `${ad.org_id}/renders/${job.ad_id}/${job.scene_id}/vo/${Date.now()}.srt`;
    const { error: srtUploadError } = await supabase.storage
      .from("renders")
      .upload(srtStoragePath, srtText, { contentType: "text/plain" });
    if (srtUploadError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", srtUploadError.message);
      return { ok: false };
    }

    const { data: existingCaptionVersions } = await supabase
      .from("assets")
      .select("version")
      .eq("org_id", ad.org_id)
      .eq("scene_id", job.scene_id)
      .eq("kind", "caption")
      .order("version", { ascending: false })
      .limit(1);
    const nextCaptionVersion = (existingCaptionVersions?.[0]?.version ?? 0) + 1;

    const { data: captionAssetRow, error: captionAssetError } = await supabase
      .from("assets")
      .insert({
        org_id: ad.org_id,
        ad_id: job.ad_id,
        scene_id: job.scene_id,
        kind: "caption",
        version: nextCaptionVersion,
        storage_path: srtStoragePath,
        source: `elevenlabs:${ELEVENLABS_STT_MODEL}`,
        meta: { words: timestampedWords, cues, voAssetId: voAssetRow.id },
      })
      .select("id")
      .single();
    if (captionAssetError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", captionAssetError.message);
      return { ok: false };
    }

    // STT per-minute pricing is the same honest gap as TTS above.
    const { data: sttPrice } = await supabase
      .from("price_table")
      .select("usd")
      .eq("provider", "elevenlabs")
      .eq("model", ELEVENLABS_STT_MODEL)
      .eq("unit", "per_minute")
      .maybeSingle();

    const audioDurationMinutes =
      timestampedWords.length > 0 ? timestampedWords[timestampedWords.length - 1].end / 60 : 0;

    await supabase.rpc("record_spend_event", {
      target_org_id: ad.org_id,
      target_ad_id: job.ad_id,
      target_provider: "elevenlabs",
      target_model: ELEVENLABS_STT_MODEL,
      target_usd_est: (sttPrice?.usd ?? 0) * audioDurationMinutes,
      target_kind: "voiceover:stt",
      target_scene_id: job.scene_id,
    });

    await supabase
      .from("jobs")
      .update({
        status: "succeeded",
        payload: { ...(job.payload as object), voAssetId: voAssetRow.id, captionAssetId: captionAssetRow.id },
      })
      .eq("id", job.id);

    return { ok: true, voAssetId: voAssetRow.id, captionAssetId: captionAssetRow.id };
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

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// Same construction run-provider-job.ts uses — see that file's
// docblock for why lib/supabase/service.ts (import "server-only")
// can't be used inside a Trigger.dev task process.
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("generate-voiceover: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
