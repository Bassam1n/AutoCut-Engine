"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chatSceneImagePrompt } from "../scene-image-chat-actions";

type Reply = { sceneNumber: number; summary: string; prompt: string };

const EXAMPLES = ["Scene 3 is the CTA, write a prompt for it", "Make the hook a guy waking up with a stiff neck"];

/**
 * "Ask Claude" on the Scene images step: the editor says in plain words
 * what a scene should show; Claude writes that scene's image prompt in
 * the scene's own style and saves it as the scene's final prompt
 * override. Nothing is generated until the editor presses Regenerate.
 */
export function SceneImageChat({
  orgId,
  brandId,
  productId,
  adId,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  adId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<(Reply & { ask: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  function send() {
    const ask = message.trim();
    if (!ask || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await chatSceneImagePrompt(orgId, brandId, productId, adId, ask);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("");
      setReplies((prev) => [{ ask, sceneNumber: result.sceneNumber, summary: result.summary, prompt: result.prompt }, ...prev].slice(0, 5));
      router.refresh();
    });
  }

  return (
    <div className="card-inset flex flex-col gap-3 p-3">
      <div>
        <p className="text-xs font-medium">✨ Ask Claude for a scene prompt</p>
        <p className="text-xs text-foreground-muted">
          Say what a scene should show. Claude writes its image prompt in that scene&apos;s style and puts it in the
          scene&apos;s final prompt box for you to review, edit and regenerate.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={2000}
          disabled={isPending}
          placeholder={`e.g. "${EXAMPLES[0]}"`}
          className="field flex-1 resize-y text-sm"
        />
        <button type="submit" disabled={isPending || !message.trim()} className="btn-primary btn-sm self-end sm:self-stretch">
          {isPending ? "Writing..." : "Write prompt"}
        </button>
      </form>

      {replies.length === 0 && !isPending && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setMessage(ex)} className="btn-ghost btn-xs">
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {replies.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {replies.map((r, i) => (
            <li key={`${i}-${r.ask}`} className="flex flex-col gap-1 py-2">
              <p className="text-xs text-foreground-muted">You: {r.ask}</p>
              <p className="text-xs">
                <span className="font-medium">Scene {r.sceneNumber} prompt updated.</span> {r.summary} Review it in the
                scene&apos;s final prompt box, then press Regenerate.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer text-foreground-muted">Show prompt</summary>
                <p className="mt-1 whitespace-pre-wrap text-foreground-muted">{r.prompt}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
