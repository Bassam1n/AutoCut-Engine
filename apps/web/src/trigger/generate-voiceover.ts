import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolveSceneSpeaks } from "@/lib/video/duration";
import { groupWordsIntoCues, cuesToSrt, type TimestampedWord } from "@/lib/captions/srt";
import { spendLimitMessage } from "@/lib/spend-limit-message";

/**
 * M10 voiceover slice (spec §5.4 bullet 5 / §6 M10) — "ElevenLabs
 * voiceover... word-level timestamps from speech-to-text drive
 * caption timing... a downloadable SRT." Scope for THIS task is
 * exactly: one whole-ad voiceover audio file + word-level timestamps
 * + an SRT file, saved as real `assets` rows. No ffmpeg, no video
 * compositing, no burned-in captions, no render/assembly service —
 * those are explicitly out of scope for this pass (see the task
 * brief); this task stops the moment the SRT asset is written.
 *
 * Deliberately NOT built on run-provider-job.ts's ProviderAdapter/
 * SubmitParams/PollResult shape. That shape exists for kie/fal's
 * submit-an-external-job-then-poll-for-completion pattern (spec
 * §5.3). ElevenLabs's TTS and STT endpoints are both plain synchronous
 * HTTP calls — the result comes back directly in the response body,
 * no external task id, nothing to poll — so forcing them through
 * submit()/poll() would mean inventing a fake external id and a fake
 * poll loop for an API that was never asynchronous in the first
 * place. This is a separate, plain task() (not schedules.task() —
 * triggered on demand per ad, never on a cron) that calls both
 * ElevenLabs endpoints inline in one run.
 *
 * Service-role Supabase client constructed the same way
 * run-provider-job.ts does (see getServiceClient() below) — not via
 * lib/supabase/service.ts, which is guarded by `import "server-only"`
 * (a Next.js-bundler-only package that doesn't resolve inside a
 * Trigger.dev task process).
 */

type GenerateVoiceoverPayload = {
  jobId: string;
};

// ElevenLabs voice selection (spec leaves this as this build's call —
// "your call whether to add an optional per-ad chosen voice_id field
// to AdBrief, or just hardcode a documented default"). Hardcoded for
// v1: no voice-picker UI exists anywhere in this app yet (Settings >
// Keys only stores/verifies the API key itself), and adding one is a
// real UI surface — a model/voice picker, previewing voices, etc —
// that's out of scope for this pass, which is "voiceover audio +
// timestamps + SRT," not "a voice-selection feature." "Rachel" is
// ElevenLabs's own long-standing default/example voice id, documented
// across their own API examples — picked as a safe, known-good
// default rather than inventing an arbitrary id. If/when a voice
// picker is built, this becomes AdBrief.voiceId (optional, same
// pattern as `speaking`) with this constant as the fallback when unset.
const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel"

const ELEVENLABS_TTS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_STT_MODEL = "scribe_v2";

export const generateVoiceover = task({
  id: "generate-voiceover",
  // TTS + STT run sequentially, each a real external HTTP call against
  // a sentence- to paragraph-length ad script — generous ceiling, not
  // a target, matching run-provider-job.ts's own "ceiling well above
  // any real job" reasoning.
  maxDuration: 300,
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

    if (!job.ad_id) {
      await failJob(supabase, job.id, "VALIDATION", "Voiceover job has no ad association.");
      return { ok: false };
    }

    await supabase.from("jobs").update({ status: "running" }).eq("id", job.id);

    const { data: ad, error: adError } = await supabase
      .from("ads")
      .select("id, org_id, brief")
      .eq("id", job.ad_id)
      .maybeSingle();
    if (adError || !ad) {
      await failJob(supabase, job.id, "VALIDATION", "Ad not found.");
      return { ok: false };
    }

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select("id, copy, speaker, idx")
      .eq("ad_id", job.ad_id)
      .order("idx");
    if (scenesError) {
      await failJob(supabase, job.id, "VALIDATION", scenesError.message);
      return { ok: false };
    }

    const brief = (ad.brief ?? {}) as { speaking?: "everyone" | "nobody" | "some_scenes" };

    // Whole-ad voiceover text: every speaking scene's copy, in scene
    // order, joined into one continuous script (spec: "ONE continuous
    // voiceover per ad"). resolveSceneSpeaks() is the same tested
    // logic Scene videos already uses — reused exactly, not
    // reimplemented, so "does this scene speak" can never drift
        // between the two features.
    const speakingLines = (scenes ?? [])
      .filter((scene) => resolveSceneSpeaks(brief.speaking, scene))
      .map((scene) => scene.copy.trim())
      .filter((line) => line.length > 0);

    if (speakingLines.length === 0) {
      await failJob(supabase, job.id, "VALIDATION", "No speaking scenes — nothing to voice.");
      return { ok: false };
    }

    const fullScript = speakingLines.join(" ");

    const voiceId = job.payload && typeof job.payload === "object" && "voiceId" in job.payload
      ? String((job.payload as { voiceId?: unknown }).voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID)
      : DEFAULT_ELEVENLABS_VOICE_ID;

    // Same spend guard every other paid call in this app goes
    // through (claim_paid_job) before any real provider cost is
    // incurred — a paused org must not be able to reach ElevenLabs
    // just because the request came in through this task instead of
    // the inline generate-reference-image.ts path.
    const { error: claimError } = await supabase.rpc("claim_paid_job", { target_org_id: ad.org_id });
    if (claimError) {
      await failJob(supabase, job.id, "SPEND_LIMIT", spendLimitMessage(claimError.message));
      return { ok: false };
    }

    const { data: apiKey, error: keyError } = await supabase.rpc("get_org_secret_value", {
      target_org_id: ad.org_id,
      target_provider: "elevenlabs",
    });
    if (keyError || !apiKey) {
      await failJob(supabase, job.id, "KEY_INVALID", "No elevenlabs key saved for this org.");
      return { ok: false };
    }

    // --- 1. TTS: one call for the whole ad's script. ---
    let audioBytes: ArrayBuffer;
    try {
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: fullScript,
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

    const audioStoragePath = `${ad.org_id}/renders/${job.ad_id}/voiceover/${Date.now()}.mp3`;
    const { error: audioUploadError } = await supabase.storage
      .from("renders")
      .upload(audioStoragePath, audioBytes, { contentType: "audio/mpeg" });
    if (audioUploadError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", audioUploadError.message);
      return { ok: false };
    }

    const { data: voAssetRow, error: voAssetError } = await supabase
      .from("assets")
      .insert({
        org_id: ad.org_id,
        ad_id: job.ad_id,
        scene_id: null, // whole-ad voiceover, not scene-scoped.
        kind: "vo",
        storage_path: audioStoragePath,
        source: `elevenlabs:${ELEVENLABS_TTS_MODEL}`,
        meta: { voiceId, script: fullScript },
      })
      .select("id")
      .single();
    if (voAssetError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", voAssetError.message);
      return { ok: false };
    }

    // price_table has no confirmed elevenlabs row (checked
    // supabase/seed_price_table.sql — no elevenlabs entry exists, and
    // no genuinely documented ElevenLabs per-character TTS / per-minute
    // STT price was found anywhere in this repo to seed one from). Per
    // this project's own precedent for z-image (seed_price_table.sql's
    // comment: "has no confirmed price yet... no number was invented
    // for it"), this is left as an honest gap rather than a guessed
    // number — record_spend_event still runs (so the real event is
    // durably logged for the spend guard and the cost breakdown UI),
    // just at $0 until a real price is confirmed and seeded.
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
      target_usd_est: (ttsPrice?.usd ?? 0) * fullScript.length,
      target_kind: "voiceover:tts",
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

    const srtStoragePath = `${ad.org_id}/renders/${job.ad_id}/voiceover/${Date.now()}.srt`;
    const { error: srtUploadError } = await supabase.storage
      .from("renders")
      .upload(srtStoragePath, srtText, { contentType: "text/plain" });
    if (srtUploadError) {
      await failJob(supabase, job.id, "PROVIDER_ERROR", srtUploadError.message);
      return { ok: false };
    }

    const { data: captionAssetRow, error: captionAssetError } = await supabase
      .from("assets")
      .insert({
        org_id: ad.org_id,
        ad_id: job.ad_id,
        scene_id: null,
        kind: "caption",
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

    // STT per-minute pricing is the same honest gap as TTS above — no
    // confirmed ElevenLabs STT price exists anywhere in this repo, so
    // this records the real event at $0 rather than inventing a number.
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
