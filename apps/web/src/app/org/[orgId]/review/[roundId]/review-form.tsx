"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { submitReview, type SceneVerdict } from "./review-actions";

export type ReviewScene = {
  id: string;
  number: number;
  copy: string;
  visual: string;
  imageUrl: string | null;
  videoUrl: string | null;
};

export type PastRound = {
  roundNo: number;
  status: string;
  overallNote: string | null;
  changes: { sceneNumber: number; comment: string | null }[];
};

type Verdict = "approved" | "changes";

/**
 * Per-scene review: every scene starts approved; the reviewer flags the
 * ones that need work and says why. Submitting sends the task to
 * Revisions (anything flagged) or Done (nothing flagged).
 */
export function ReviewForm({
  orgId,
  roundId,
  status,
  adName,
  adHref,
  scenes,
  submitted,
  pastRounds,
}: {
  orgId: string;
  roundId: string;
  status: "open" | "changes_requested" | "approved";
  adName: string;
  adHref: string;
  scenes: ReviewScene[];
  submitted: { overallNote: string | null; verdicts: Record<string, { verdict: Verdict; comment: string | null }> } | null;
  pastRounds: PastRound[];
}) {
  const router = useRouter();
  const readOnly = status !== "open";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(submitted?.overallNote ?? "");
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: Verdict; comment: string }>>(() =>
    Object.fromEntries(
      scenes.map((s) => {
        const prior = submitted?.verdicts[s.id];
        return [s.id, { verdict: prior?.verdict ?? "approved", comment: prior?.comment ?? "" }];
      })
    )
  );

  const flagged = Object.values(verdicts).filter((v) => v.verdict === "changes").length;

  function setVerdict(sceneId: string, patch: Partial<{ verdict: Verdict; comment: string }>) {
    setVerdicts((v) => ({ ...v, [sceneId]: { ...v[sceneId], ...patch } }));
  }

  function submit() {
    setError(null);
    const list: SceneVerdict[] = scenes.map((s) => ({
      sceneId: s.id,
      verdict: verdicts[s.id].verdict,
      comment: verdicts[s.id].comment,
    }));
    startTransition(async () => {
      const result = await submitReview(orgId, roundId, note, list);
      if (result.ok) router.push(`/org/${orgId}/board`);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs text-foreground-muted">Ad</p>
          <p className="truncate font-medium">{adName}</p>
        </div>
        <div className="flex items-center gap-2">
          {readOnly && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                status === "approved" ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
              }`}
            >
              {status === "approved" ? "Approved" : "Changes requested"}
            </span>
          )}
          <Link href={adHref} className="btn-secondary btn-sm">
            Open in studio
          </Link>
        </div>
      </div>

      {scenes.length === 0 ? (
        <p className="card-inset px-4 py-3 text-sm text-foreground-muted">This ad has no scenes yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {scenes.map((scene) => {
            const v = verdicts[scene.id];
            const needsChanges = v.verdict === "changes";
            return (
              <li
                key={scene.id}
                className={`card flex flex-col gap-4 p-4 ${needsChanges ? "border-danger/40" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">Scene {scene.number}</h2>
                    {scene.copy && <p className="mt-1 text-sm">{scene.copy}</p>}
                    {scene.visual && <p className="mt-1 text-xs text-foreground-muted">{scene.visual}</p>}
                  </div>
                  <div role="radiogroup" aria-label={`Scene ${scene.number} verdict`} className="flex rounded-full border border-border bg-background-raised p-0.5">
                    {(["approved", "changes"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={v.verdict === option}
                        disabled={readOnly || isPending}
                        onClick={() => setVerdict(scene.id, { verdict: option })}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          v.verdict === option
                            ? option === "approved"
                              ? "bg-accent-soft text-accent"
                              : "bg-danger-soft text-danger"
                            : "text-foreground-muted hover:text-foreground"
                        }`}
                      >
                        {option === "approved" ? "Approve" : "Request changes"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <figure className="flex flex-col gap-1.5">
                    <figcaption className="text-xs text-foreground-muted">Image</figcaption>
                    {scene.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={scene.imageUrl} alt={`Scene ${scene.number} image`} className="w-full rounded-xl border border-border object-cover" />
                    ) : (
                      <p className="card-inset px-3 py-6 text-center text-xs text-foreground-muted">No image yet</p>
                    )}
                  </figure>
                  <figure className="flex flex-col gap-1.5">
                    <figcaption className="text-xs text-foreground-muted">Video</figcaption>
                    {scene.videoUrl ? (
                      <video src={scene.videoUrl} controls preload="metadata" className="w-full rounded-xl border border-border bg-black" />
                    ) : (
                      <p className="card-inset px-3 py-6 text-center text-xs text-foreground-muted">No video yet</p>
                    )}
                  </figure>
                </div>

                {needsChanges && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium">What should change?</span>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={v.comment}
                      onChange={(e) => setVerdict(scene.id, { comment: e.target.value })}
                      disabled={readOnly || isPending}
                      placeholder="e.g. Make the bottle bigger and move it to the left third."
                      className="field resize-none"
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="card flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Overall note (optional)</span>
          <textarea
            rows={2}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={readOnly || isPending}
            className="field resize-none"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={submit} disabled={isPending} className="btn-primary">
              {isPending ? "Submitting..." : flagged > 0 ? `Request changes (${flagged})` : "Approve all"}
            </button>
            <span className="text-xs text-foreground-muted">
              {flagged > 0
                ? "The task moves to Revisions and the editor is notified."
                : "The task moves to Done and the editor is notified."}
            </span>
          </div>
        )}
      </div>

      {pastRounds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Earlier rounds</h2>
          {pastRounds.map((r) => (
            <details key={r.roundNo} className="card-inset px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Round {r.roundNo}: {r.status === "approved" ? "approved" : "changes requested"}
              </summary>
              <div className="mt-2 flex flex-col gap-1.5 text-foreground-muted">
                {r.overallNote && <p>{r.overallNote}</p>}
                {r.changes.map((c, i) => (
                  <p key={i}>
                    <span className="font-medium text-foreground">Scene {c.sceneNumber}:</span> {c.comment}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
