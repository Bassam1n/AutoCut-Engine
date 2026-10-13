"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncButton } from "@/components/async-button";
import { startSceneVoiceoverJob, getVoiceoverJobStatus } from "@/lib/jobs/run-voiceover-job";
import {
  searchElevenLabsVoices,
  getElevenLabsVoiceById,
  addSharedVoiceToAccount,
  suggestVoiceoverDelivery,
  type ElevenLabsVoice,
} from "./voiceover-data";
import { resolveSceneSpeaks } from "@/lib/video/duration";
import type { Ad, AdBrief } from "../ads-data";
import type { Scene } from "../scenes-data";
import type { SceneVoiceover, SceneVoiceoverJob } from "../scene-videos-data";

const POLL_INTERVAL_MS = 4000;

/**
 * Voiceover Studio step — a real step of its own (not a panel bolted
 * onto Scene videos), modeled on an ElevenLabs-style text-to-speech
 * UI: pick a voice from a real list with audio preview, edit the
 * script that will actually be sent, generate PER SCENE.
 *
 * Why per-scene, not whole-ad (user-confirmed requirement): each
 * speaking scene gets its own ElevenLabs TTS call and its own `vo`
 * asset scoped with scene_id — this is what makes the per-scene
 * reference-audio wiring into video generation possible at all (a
 * single whole-ad clip has no way to line up with one scene's video
 * generation call).
 *
 * The voice search (free text + gender/age/library filters, debounced)
 * is shared across the whole step — every scene picks from the same
 * result set — while the picked voice and editable script are tracked
 * per scene, since different scenes legitimately want different
 * delivery/emotion. Each scene card can also pull in an extra voice
 * directly by ID, merged into just that scene's own picker.
 */
export function VoiceoverStep({
  orgId,
  brandId,
  productId,
  ad,
  scenes,
  voiceoversBySceneId,
  activeJobsBySceneId,
  assetUrls,
  onContinue,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  scenes: Scene[];
  voiceoversBySceneId: Record<string, SceneVoiceover>;
  activeJobsBySceneId: Record<string, SceneVoiceoverJob>;
  assetUrls: Record<string, string>;
  onContinue: () => void;
}) {
  const [voices, setVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [hasMoreVoices, setHasMoreVoices] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMoreVoices, setIsLoadingMoreVoices] = useState(false);

  // Filters an editor can combine: free-text search, gender, age, and
  // premade-vs-community (ElevenLabs' full shared library — hundreds
  // of voices, per the user's explicit ask that premade-only was too
  // limiting), plus a client-side "most used" re-sort (see
  // voiceover-data.ts's docblock for why that can't be a true
  // full-library popularity rank). Shared across every scene card —
  // one search result set, each scene just picks from it.
  const [searchText, setSearchText] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [voiceType, setVoiceType] = useState<"premade" | "community">("premade");
  const [sortByMostUsed, setSortByMostUsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setIsLoadingVoices(true);
      setVoicesError(null);
      const result = await searchElevenLabsVoices(orgId, {
        search: searchText.trim() || undefined,
        gender: genderFilter || undefined,
        age: ageFilter || undefined,
        voiceType,
        sortByMostUsed,
      });
      if (cancelled) return;
      setIsLoadingVoices(false);
      if (result.ok) {
        setVoices(result.voices);
        setHasMoreVoices(result.hasMore);
        setNextPageToken(result.nextPageToken);
      } else {
        setVoices([]);
        setHasMoreVoices(false);
        setNextPageToken(null);
        setVoicesError(result.error);
      }
    }, 300); // debounced — free-text search re-queries ElevenLabs on every keystroke otherwise
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // Any filter change starts a fresh page-1 search — only "Load
    // more" below continues pagination within the current filter set.
  }, [orgId, searchText, genderFilter, ageFilter, voiceType, sortByMostUsed]);

  // A single page (max page_size=100) under a narrow filter (e.g.
  // community + female + young) can come back thin or empty even
  // though more matches exist on later pages — ElevenLabs's own
  // library has hundreds of voices, not 100. This follows has_more/
  // next_page_token to keep going, appending rather than replacing.
  async function onLoadMoreVoices() {
    if (!nextPageToken) return;
    setIsLoadingMoreVoices(true);
    const result = await searchElevenLabsVoices(orgId, {
      search: searchText.trim() || undefined,
      gender: genderFilter || undefined,
      age: ageFilter || undefined,
      voiceType,
      sortByMostUsed,
      nextPageToken,
    });
    setIsLoadingMoreVoices(false);
    if (result.ok) {
      setVoices((prev) => [...(prev ?? []), ...result.voices]);
      setHasMoreVoices(result.hasMore);
      setNextPageToken(result.nextPageToken);
    } else {
      setVoicesError(result.error);
    }
  }

  // brandId/productId aren't needed by this step's own actions (voice
  // listing and voiceover generation only need orgId/sceneId), but
  // kept in the signature for the same reason every sibling step
  // (SceneImagesStep, SceneVideosStep) takes them — a consistent prop
  // shape from studio-canvas.tsx, in case a future addition here
  // (e.g. a "view in library" link) needs them.
  void brandId;
  void productId;

  const speakingScenes = scenes.filter((scene) => resolveSceneSpeaks(ad.brief.speaking, scene));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Voiceover</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Pick a voice, edit the line each scene will actually say, and generate a
          separate ElevenLabs voiceover clip per speaking scene. Optional — Scene
          videos works fine with no voiceover at all, but when a scene has one, its
          clip is automatically used as reference audio for that scene&apos;s video.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search voices by name…"
            className="min-w-[160px] flex-1 rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-xs outline-none"
          />
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs outline-none"
          >
            <option value="">Any gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
          </select>
          <select
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value)}
            className="rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs outline-none"
          >
            <option value="">Any age</option>
            <option value="young">Young</option>
            <option value="middle_aged">Middle-aged</option>
            <option value="old">Old</option>
          </select>
          <select
            value={voiceType}
            onChange={(e) => setVoiceType(e.target.value as "premade" | "community")}
            className="rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs outline-none"
          >
            <option value="premade">Premade library</option>
            <option value="community">Community library</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <input
              type="checkbox"
              checked={sortByMostUsed}
              onChange={(e) => setSortByMostUsed(e.target.checked)}
            />
            Most used first
          </label>
        </div>
        <p className="text-[11px] text-foreground-muted">
          Community library searches ElevenLabs&apos; full shared voice catalog (hundreds
          of voices), not just the small premade set.
        </p>
      </div>

      {isLoadingVoices && <p className="text-sm text-foreground-muted">Loading voices…</p>}
      {voicesError && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          {voicesError}
        </p>
      )}
      {!isLoadingVoices && !voicesError && voices && voices.length === 0 && (
        <p className="text-sm text-foreground-muted">
          No voices matched these filters — try loosening gender/age or switching library.
        </p>
      )}
      {!isLoadingVoices && hasMoreVoices && (
        <button
          type="button"
          onClick={onLoadMoreVoices}
          disabled={isLoadingMoreVoices}
          className="self-start text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          {isLoadingMoreVoices ? "Loading more…" : "Load more voices"}
        </button>
      )}

      {speakingScenes.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No speaking scenes yet — nothing to voice. Set &quot;who speaks on camera&quot;
          in Scene videos, or add copy to a scene, then come back here.
        </p>
      ) : (
        voices && (
          <div className="flex flex-col gap-4">
            {speakingScenes.map((scene) => (
              <SceneVoiceoverCard
                key={scene.id}
                orgId={orgId}
                scene={scene}
                brief={ad.brief}
                voices={voices}
                existing={voiceoversBySceneId[scene.id] ?? null}
                activeJob={activeJobsBySceneId[scene.id] ?? null}
                assetUrls={assetUrls}
              />
            ))}
          </div>
        )
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Continue to Scene videos
        </button>
      </div>
    </div>
  );
}

function SceneVoiceoverCard({
  orgId,
  scene,
  brief,
  voices,
  existing,
  activeJob,
  assetUrls,
}: {
  orgId: string;
  scene: Scene;
  brief: AdBrief;
  voices: ElevenLabsVoice[];
  existing: SceneVoiceover | null;
  activeJob: SceneVoiceoverJob | null;
  assetUrls: Record<string, string>;
}) {
  const router = useRouter();
  // Script auto-assembles from scene.copy as a starting default, but
  // is fully editable — whatever text sits in the textarea at submit
  // time is what's sent to ElevenLabs, not necessarily raw scene.copy
  // (the user's #2 requirement: emotion tags, rephrasing, etc). Once
  // a voiceover already exists, re-opening this step shows the script
  // that was actually used last time (asset.meta.script), not
  // scene.copy again, so an editor's prior edit isn't silently lost
  // on reload.
  const [script, setScript] = useState<string>(
    (existing?.voAsset.meta?.script as string | undefined) ?? scene.copy
  );
  const [voiceId, setVoiceId] = useState<string>(
    (existing?.voAsset.meta?.voiceId as string | undefined) ?? voices[0]?.voiceId ?? ""
  );
  const [isGenerating, setIsGenerating] = useState(Boolean(activeJob));
  const [error, setError] = useState<string | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(activeJob?.id ?? null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Voices added directly by ID (user's explicit ask: "by providing
  // the voice id") — kept separate from the shared search results and
  // merged in below, since a pasted ID may never appear in any
  // premade/community search page at all.
  const [voiceIdInput, setVoiceIdInput] = useState("");
  const [isLookingUpVoiceId, setIsLookingUpVoiceId] = useState(false);
  const [voiceIdError, setVoiceIdError] = useState<string | null>(null);
  const [addedVoices, setAddedVoices] = useState<ElevenLabsVoice[]>([]);

  // Selecting a community/shared-library voice (publicOwnerId set)
  // isn't immediately usable for generation — ElevenLabs requires it
  // be added to the account first, which mints a NEW voice_id (see
  // voiceover-data.ts's docblock). isAddingVoice tracks that one-time
  // add call so the voice list can show a pending state and onGenerate
  // can be blocked until it resolves.
  const [isAddingVoice, setIsAddingVoice] = useState(false);
  const [addVoiceError, setAddVoiceError] = useState<string | null>(null);

  // "Suggest voice + delivery" assist — a TONE description (words
  // only, never a specific voice_id/voice name: see
  // voiceover-delivery.ts's schema doc comment for why) plus a
  // pre-filled, tag-annotated rewrite of the script. Pre-fills script
  // without submitting anything — same "edit freely before Generate"
  // flow as the existing scene.copy default.
  const [toneDescription, setToneDescription] = useState<string | null>(null);
  const [isSuggestingDelivery, setIsSuggestingDelivery] = useState(false);
  const [suggestDeliveryError, setSuggestDeliveryError] = useState<string | null>(null);

  async function onSuggestDelivery() {
    setSuggestDeliveryError(null);
    setIsSuggestingDelivery(true);
    try {
      const result = await suggestVoiceoverDelivery(orgId, scene.copy, brief);
      if (!result.ok) {
        setSuggestDeliveryError(result.error);
        return;
      }
      setToneDescription(result.tone_description);
      setScript(result.delivery_script);
    } finally {
      setIsSuggestingDelivery(false);
    }
  }

  async function onSelectVoice(voice: ElevenLabsVoice) {
    setAddVoiceError(null);
    if (!voice.publicOwnerId) {
      setVoiceId(voice.voiceId);
      return;
    }
    // Already added earlier this session (addedVoices tracks it with
    // publicOwnerId cleared once added) — just select it.
    const alreadyAdded = addedVoices.find((v) => v.voiceId === voice.voiceId && !v.publicOwnerId);
    if (alreadyAdded) {
      setVoiceId(alreadyAdded.voiceId);
      return;
    }
    setIsAddingVoice(true);
    try {
      const result = await addSharedVoiceToAccount(orgId, voice.publicOwnerId, voice.voiceId, voice.name);
      if (!result.ok) {
        setAddVoiceError(result.error);
        return;
      }
      const addedVoice: ElevenLabsVoice = { ...voice, voiceId: result.voiceId, publicOwnerId: null };
      setAddedVoices((prev) => [addedVoice, ...prev]);
      setVoiceId(result.voiceId);
    } finally {
      setIsAddingVoice(false);
    }
  }

  async function onAddVoiceById() {
    setVoiceIdError(null);
    const id = voiceIdInput.trim();
    if (!id) return;
    setIsLookingUpVoiceId(true);
    try {
      const result = await getElevenLabsVoiceById(orgId, id);
      if (!result.ok) {
        setVoiceIdError(result.error);
        return;
      }
      setAddedVoices((prev) => (prev.some((v) => v.voiceId === result.voice.voiceId) ? prev : [result.voice, ...prev]));
      setVoiceIdInput("");
      // A shared-library match (publicOwnerId set) still needs the
      // same add-to-account step as a voice picked from the Community
      // search results — same reasoning as onSelectVoice below.
      await onSelectVoice(result.voice);
    } finally {
      setIsLookingUpVoiceId(false);
    }
  }

  const displayedVoices = [...addedVoices.filter((v) => !voices.some((listed) => listed.voiceId === v.voiceId)), ...voices];

  useEffect(() => {
    if (!activeJob) return;
    jobIdRef.current = activeJob.id;
    const interval = setInterval(async () => {
      const jobId = jobIdRef.current;
      if (!jobId) return;
      const status = await getVoiceoverJobStatus(orgId, jobId);
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
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arms only on a fresh mount/reload against an already-known active job
  }, [activeJob?.id]);

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
    if (isAddingVoice) {
      setError("Still adding that voice to your account — try again in a moment.");
      return;
    }
    if (!voiceId) {
      setError("Pick a voice first.");
      return;
    }
    if (!script.trim()) {
      setError("Script is empty.");
      return;
    }
    setIsGenerating(true);
    try {
      // Regenerating (editing the script and/or voice, then
      // generating again) creates a NEW version of this scene's `vo`
      // asset — never overwrites — exactly like every other asset
      // type in this app (scene images/videos). The old version stays
      // readable; nothing is lost.
      const result = await startSceneVoiceoverJob(orgId, scene.id, voiceId, script);
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

  function onPreviewVoice(voice: ElevenLabsVoice) {
    if (!voice.previewUrl) return;
    // Plain <audio> element playback of ElevenLabs's own preview_url —
    // no extra API call needed, per the confirmed voice-list response
    // shape already carrying a ready-to-play preview URL.
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }
    const audio = new Audio(voice.previewUrl);
    previewAudioRef.current = audio;
    setPreviewingVoiceId(voice.voiceId);
    audio.play().catch(() => {});
    audio.onended = () => setPreviewingVoiceId((current) => (current === voice.voiceId ? null : current));
  }

  const voAudioUrl = existing ? assetUrls[existing.voAsset.storage_path] ?? null : null;
  const srtUrl = existing?.captionAsset ? assetUrls[existing.captionAsset.storage_path] ?? null : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground-muted">Scene {scene.idx + 1}</span>
        {existing && <span className="text-xs text-foreground-muted">v{existing.voAsset.version}</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">Voice</label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={voiceIdInput}
            onChange={(e) => setVoiceIdInput(e.target.value)}
            placeholder="Add by voice ID…"
            className="flex-1 rounded-lg border border-border-strong bg-background px-2 py-1 text-xs outline-none"
          />
          <AsyncButton
            onClick={onAddVoiceById}
            isPending={isLookingUpVoiceId}
            pendingLabel="Looking up…"
            className="shrink-0 rounded-lg border border-border-strong px-2 py-1 text-xs font-medium transition-colors hover:bg-border/40"
          >
            Add
          </AsyncButton>
        </div>
        {voiceIdError && <p className="text-xs text-danger">{voiceIdError}</p>}
        {addVoiceError && <p className="text-xs text-danger">{addVoiceError}</p>}
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border-strong p-1">
          {displayedVoices.length === 0 && (
            <p className="p-2 text-xs text-foreground-muted">No voices available.</p>
          )}
          {displayedVoices.map((voice) => {
            const isSelected = voice.voiceId === voiceId;
            return (
              <div
                key={voice.voiceId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  isSelected ? "bg-accent-soft text-accent" : "hover:bg-border/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectVoice(voice)}
                  disabled={isAddingVoice}
                  className="flex-1 text-left disabled:opacity-50"
                >
                  <span className="font-medium">{voice.name}</span>
                  {voice.publicOwnerId && (
                    <span className="ml-1.5 text-[10px] text-foreground-muted">(community)</span>
                  )}
                  {(voice.accent || voice.gender) && (
                    <span className="ml-1.5 text-foreground-muted">
                      {[voice.gender, voice.accent].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
                {voice.previewUrl && (
                  <button
                    type="button"
                    onClick={() => onPreviewVoice(voice)}
                    title="Preview this voice"
                    className="shrink-0 rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-border/40"
                  >
                    {previewingVoiceId === voice.voiceId ? "▶ Playing" : "▶ Preview"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium">Script</label>
          <AsyncButton
            onClick={onSuggestDelivery}
            isPending={isSuggestingDelivery}
            pendingLabel="Thinking..."
            className="shrink-0 rounded-full border border-border-strong px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-border/40"
          >
            ✨ Suggest voice + delivery
          </AsyncButton>
        </div>
        <p className="text-xs text-foreground-muted">
          Pre-filled from this scene&apos;s copy — edit freely (add emotion tags,
          rephrase, etc). Whatever is here is exactly what gets sent to ElevenLabs.
        </p>
        {suggestDeliveryError && <p className="text-xs text-danger">{suggestDeliveryError}</p>}
        {toneDescription && (
          <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
            Suggested tone: {toneDescription}
          </p>
        )}
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={3}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
        />
        {toneDescription && (
          <p className="text-[11px] text-foreground-muted">
            Delivery tags like [warmly] are ElevenLabs-style audio tags — best effort,
            not guaranteed to be honored by every voice/model.
          </p>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {voAudioUrl && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <audio src={voAudioUrl} controls className="w-full" />
          {srtUrl && (
            <a href={srtUrl} download className="self-start text-xs font-medium text-accent hover:underline">
              Download SRT
            </a>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <AsyncButton
          onClick={onGenerate}
          isPending={isGenerating}
          pendingLabel="Generating..."
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {existing ? "Regenerate" : "Generate voiceover"}
        </AsyncButton>
      </div>
    </div>
  );
}
