"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncButton } from "@/components/async-button";
import { startAdVoiceoverJob, getVoiceoverJobStatus } from "@/lib/jobs/run-voiceover-job";

const POLL_INTERVAL_MS = 4000;

/**
 * Minimal UI for the whole-ad voiceover pipeline (spec §5.4 bullet 5):
 * one button to generate, a player for the result, and an SRT
 * download link. No voice picker (the backend defaults to a single
 * ElevenLabs voice — see generate-voiceover.ts's documented
 * reasoning) and no caption burn-in/safe-zone preview, since neither
 * exists yet — this only surfaces what the backend actually produces:
 * an audio file and a downloadable .srt.
 */
export function VoiceoverPanel({
  orgId,
  adId,
  hasExistingVoiceover,
  voiceoverAudioUrl,
  srtUrl,
}: {
  orgId: string;
  adId: string;
  hasExistingVoiceover: boolean;
  voiceoverAudioUrl: string | null;
  srtUrl: string | null;
}) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      jobIdRef.current = null;
    };
  }, []);

  function pollJob(jobId: string) {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    const interval = setInterval(async () => {
      const currentJobId = jobIdRef.current;
      if (!currentJobId) {
        clearInterval(interval);
        return;
      }
      const status = await getVoiceoverJobStatus(orgId, currentJobId);
      if (!status.ok) return;
      if (status.status === "succeeded") {
        clearInterval(interval);
        setIsGenerating(false);
        jobIdRef.current = null;
        router.refresh();
      } else if (status.status === "failed" || status.status === "cancelled") {
        clearInterval(interval);
        setIsGenerating(false);
        jobIdRef.current = null;
        setError(status.error ?? "Voiceover generation failed.");
      }
    }, POLL_INTERVAL_MS);
  }

  async function onGenerate() {
    setError(null);
    setIsGenerating(true);
    try {
      const result = await startAdVoiceoverJob(orgId, adId);
      if (!result.ok) {
        setIsGenerating(false);
        setError(result.error);
        return;
      }
      pollJob(result.jobId);
    } catch (err) {
      setIsGenerating(false);
      setError(err instanceof Error ? err.message : "Voiceover generation failed.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background-raised/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Voiceover</h3>
          <p className="mt-0.5 text-xs text-foreground-muted">
            One continuous voiceover across every speaking scene, with word-level
            timestamps and a downloadable SRT.
          </p>
        </div>
        <AsyncButton
          onClick={onGenerate}
          isPending={isGenerating}
          pendingLabel="Generating..."
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {hasExistingVoiceover ? "Regenerate" : "Generate voiceover"}
        </AsyncButton>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {voiceoverAudioUrl && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <audio src={voiceoverAudioUrl} controls className="w-full" />
          {srtUrl && (
            <a
              href={srtUrl}
              download
              className="self-start text-xs font-medium text-accent hover:underline"
            >
              Download SRT
            </a>
          )}
        </div>
      )}
    </div>
  );
}
