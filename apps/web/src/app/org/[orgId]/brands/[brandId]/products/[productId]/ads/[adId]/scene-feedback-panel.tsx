"use client";

/**
 * Per-scene Tweak/Rework feedback form (spec §5.8). One shared
 * component used by both SceneImageCard (scene-images-step.tsx) and
 * SceneVideoCard (scene-videos-step.tsx) — the two cards differ only
 * in which submit action they pass in (submitImageFeedback vs
 * submitVideoFeedback) and whether a reference-image attachment makes
 * sense (image feedback only; spec doesn't describe an attachable
 * reference for video feedback, and submitVideoFeedback's signature
 * has no slot for one).
 *
 * Always targets the CURRENT/latest version of the scene's image or
 * video — there is no historical-version picker here, by design (see
 * the task brief this was built from): feedback always means "change
 * the one that's showing now."
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AsyncButton } from "@/components/async-button";
import {
  reserveFeedbackRoundReferenceUploadPath,
  type FeedbackMode,
  type TweakReworkResult,
  type VideoFeedbackResult,
} from "../feedback-actions";

type SubmitResult = TweakReworkResult | VideoFeedbackResult;

export function SceneFeedbackPanel({
  orgId,
  adId,
  sceneId,
  allowReferenceAttachment,
  onSubmit,
  onVideoJobStarted,
}: {
  orgId: string;
  adId: string;
  sceneId: string;
  /** Image feedback only — submitVideoFeedback has no attachment param. */
  allowReferenceAttachment: boolean;
  onSubmit: (args: {
    mode: FeedbackMode;
    feedbackText: string;
    remember: boolean;
    attachedReferenceStoragePath?: string;
  }) => Promise<SubmitResult>;
  /** Video feedback only — called with the returned jobId so the card's own poller can take over. */
  onVideoJobStarted?: (jobId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<FeedbackMode>("tweak");
  const [feedbackText, setFeedbackText] = useState("");
  const [remember, setRemember] = useState(false);
  const [attachedPath, setAttachedPath] = useState<string | null>(null);
  const [isUploadingRef, setIsUploadingRef] = useState(false);
  const [refUploadError, setRefUploadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function onAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setRefUploadError(null);
    setIsUploadingRef(true);
    try {
      const reserved = await reserveFeedbackRoundReferenceUploadPath(orgId, adId, sceneId, file.name);
      if (!reserved.ok) {
        setRefUploadError(reserved.error);
        return;
      }
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .upload(reserved.path, file, { upsert: false });
      if (uploadError) {
        setRefUploadError(uploadError.message);
        return;
      }
      setAttachedPath(reserved.path);
    } finally {
      setIsUploadingRef(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearAttachedFile() {
    setAttachedPath(null);
  }

  async function onSubmitFeedback() {
    if (!feedbackText.trim()) return;
    setIsSubmitting(true);
    // Deliberately NOT clearing result/feedbackText before the call —
    // on an isQuestion/reworkDiffFailed response the editor's typed
    // text needs to stay exactly as-is so they can edit it in place,
    // per the task brief ("let the editor edit and resubmit, don't
    // clear their typed text").
    try {
      const outcome = await onSubmit({
        mode,
        feedbackText,
        remember,
        attachedReferenceStoragePath: allowReferenceAttachment ? attachedPath ?? undefined : undefined,
      });
      setResult(outcome);
      if (outcome.ok) {
        setAttachedPath(null);
        if ("jobId" in outcome) {
          // Video feedback: hand the jobId to the card's own poller
          // (exact same poll→finalize→router.refresh() pattern as the
          // original Generate flow) instead of duplicating that logic
          // here.
          onVideoJobStarted?.(outcome.jobId);
        } else {
          // Image feedback finishes synchronously — the new asset
          // version is already written, just needs the page to see it.
          router.refresh();
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="btn-secondary btn-sm self-start"
      >
        {isOpen ? "Hide feedback" : "Give feedback"}
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background-raised/40 p-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <ModeButton active={mode === "tweak"} onClick={() => setMode("tweak")}>
                Tweak
              </ModeButton>
              <ModeButton active={mode === "rework"} onClick={() => setMode("rework")}>
                Rework
              </ModeButton>
            </div>
            <p className="text-xs text-foreground-muted">
              {mode === "tweak"
                ? "Tweak: a small surgical change — everything else stays identical."
                : "Rework: a bigger change — Claude double-checks afterward that nothing else drifted."}
            </p>
          </div>

          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            rows={3}
            placeholder="Describe the change you want — e.g. 'make the background darker' rather than a question."
            className="field resize-none"
          />

          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong"
            />
            Remember this kind of correction
          </label>

          {allowReferenceAttachment && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label
                  className={`btn-secondary btn-sm ${
                    isUploadingRef ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-border/40"
                  }`}
                >
                  {isUploadingRef ? "Uploading..." : attachedPath ? "Replace attached reference" : "Attach reference image"}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onAttachFile}
                    disabled={isUploadingRef}
                    className="hidden"
                  />
                </label>
                {attachedPath && (
                  <button
                    type="button"
                    onClick={clearAttachedFile}
                    className="text-xs font-medium text-foreground-muted hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              {refUploadError && <p className="text-xs text-danger">{refUploadError}</p>}
            </div>
          )}

          <div>
            <AsyncButton
              onClick={onSubmitFeedback}
              isPending={isSubmitting}
              pendingLabel="Submitting..."
              disabled={!feedbackText.trim()}
              className="btn-primary btn-sm"
            >
              Submit feedback
            </AsyncButton>
          </div>

          {result && <FeedbackResultNote result={result} />}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "border-accent bg-accent-soft text-accent" : "border-border-strong hover:bg-border/40"
      }`}
    >
      {children}
    </button>
  );
}

function FeedbackResultNote({ result }: { result: SubmitResult }) {
  if (!result.ok) {
    const isReworkDiffFailure = "reworkDiffFailed" in result && result.reworkDiffFailed === true;
    if (isReworkDiffFailure) {
      const unrelatedChanges = (result as { unrelatedChanges: string[] }).unrelatedChanges;
      return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs">
          <p className="font-medium text-danger">{result.error}</p>
          {unrelatedChanges.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground-muted">What drifted that you didn&apos;t ask for:</span>
              <ul className="list-disc pl-4 text-foreground-muted">
                {unrelatedChanges.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-foreground-muted">
            Nothing was generated for this attempt. Adjust your feedback to be more specific, or switch to Tweak for a
            smaller surgical change, then submit again.
          </p>
        </div>
      );
    }
    const isQuestion = "isQuestion" in result && result.isQuestion === true;
    if (isQuestion) {
      const rephraseHint = (result as { rephraseHint?: string | null }).rephraseHint;
      return (
        <div className="flex flex-col gap-1 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs">
          <p className="font-medium text-danger">{result.error}</p>
          {rephraseHint && <p className="text-foreground-muted">Hint: {rephraseHint}</p>}
          <p className="text-foreground-muted">Edit your feedback above and submit again.</p>
        </div>
      );
    }
    return (
      <div className="text-xs text-danger">
        <p>{result.error}</p>
      </div>
    );
  }

  // Success.
  if ("jobId" in result) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-accent/30 bg-accent-soft/40 p-2.5 text-xs">
        <p className="font-medium text-accent">Feedback accepted — generating the updated clip.</p>
        <p className="text-foreground-muted">{result.changeSummary}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-accent/30 bg-accent-soft/40 p-2.5 text-xs">
      <p className="font-medium text-accent">Done.</p>
      <p className="text-foreground-muted">{result.changeSummary}</p>
      {result.rebuiltWithoutReference && (
        <p className="text-foreground-muted/80">
          This was a placement or removal change, so the image was rebuilt without feeding the old image back in as a
          reference — only your attached reference (if any) was used.
        </p>
      )}
      {result.reworkDiff?.passed && (
        <p className="text-foreground-muted/80">Verified: only the requested change was made.</p>
      )}
    </div>
  );
}
