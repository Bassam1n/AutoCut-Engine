"use client";

import { useRef, useState } from "react";
import { parseMp4Header } from "@/lib/auto-edit/mp4-header";
import { footageLabel, footageShortLabel } from "@/lib/auto-edit/plan-schema";
import { createClient } from "@/lib/supabase/client";
import { addTimelineUpload, removeTimelineUpload, reserveTimelineUpload, type EditorScene } from "../auto-edit-actions";

/**
 * The footage the timeline can use: the ad's generated scene clips and
 * clips the editor uploads from their device. Any of them goes onto the
 * timeline after the clip under the playhead. Uploads go straight from
 * the browser to storage (the server checks access, quota and the file
 * first, and records it after), like the other uploads in AutoCut.
 */
export function MediaBin({
  orgId,
  adId,
  scenes,
  locked,
  durations,
  onInsert,
  onUploaded,
  onRemoved,
}: {
  orgId: string;
  adId: string;
  scenes: EditorScene[];
  locked: boolean;
  /** Seconds of each footage index, when known. */
  durations: Record<number, number>;
  onInsert: (index: number, duration: number) => void;
  onUploaded: (scene: EditorScene) => void;
  onRemoved: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setNote(null);
    setBusy(`Reading ${file.name}...`);
    try {
      const played = await readVideo(file);
      const meta = played ?? parseMp4Header(await file.arrayBuffer());
      if (!meta) {
        setError("That file couldn't be read as a video. Use an MP4 or MOV file.");
        return;
      }
      if (!played) setNote(`This browser can't play ${file.name}, so the preview shows it black. It will still be in the render and the exports.`);
      const reserved = await reserveTimelineUpload(orgId, adId, file.name, file.size, file.type || "video/mp4");
      if (!reserved.ok) return setError(reserved.error);
      setBusy(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)...`);
      const { error: upError } = await createClient().storage.from("renders").upload(reserved.path, file, { upsert: false, contentType: file.type || "video/mp4" });
      if (upError) return setError(`The upload failed: ${upError.message}`);
      const added = await addTimelineUpload(orgId, adId, reserved.path, { name: file.name, ...meta });
      if (!added.ok) return setError(added.error);
      onUploaded(added.scene);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(s: EditorScene) {
    if (!s.upload || !window.confirm(`Remove ${s.upload.name} from this ad's media?`)) return;
    setError(null);
    const res = await removeTimelineUpload(orgId, adId, s.upload.assetId);
    if (!res.ok) return setError(res.error);
    onRemoved(s.index);
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-medium text-foreground-muted">Media</span>
        {scenes.filter((s) => s.videoUrl || s.upload).map((s) => {
          const d = durations[s.index] ?? s.upload?.duration;
          return (
            <span
              key={s.index}
              className={`flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 ${s.upload ? "border-teal-500/50 bg-teal-500/10" : "border-sky-500/50 bg-sky-500/10"}`}
              title={s.upload ? `${footageLabel(s.index)}: ${s.upload.name}` : `${footageLabel(s.index)}: ${s.copy}`}
            >
              <span className="font-medium">{footageShortLabel(s.index)}</span>
              {s.upload && <span className="max-w-28 truncate text-foreground-muted">{s.upload.name}</span>}
              {d ? <span className="tabular-nums text-foreground-muted">{d.toFixed(1)}s</span> : null}
              <button
                type="button"
                className="rounded-full px-1 hover:bg-accent/20 disabled:opacity-40"
                disabled={locked || !d}
                onClick={() => d && onInsert(s.index, d)}
                title="Add to the timeline after the clip at the playhead"
                aria-label={`Add ${footageLabel(s.index)} to the timeline`}
              >
                +
              </button>
              {s.upload && (
                <button type="button" className="rounded-full px-1 text-foreground-muted hover:bg-danger/20 disabled:opacity-40" disabled={locked} onClick={() => remove(s)} aria-label={`Remove ${s.upload.name}`} title="Remove from this ad's media">
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button type="button" className="btn-secondary btn-sm" disabled={locked || Boolean(busy)} onClick={() => input.current?.click()}>
          Upload clip from device
        </button>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      {busy && <p className="text-foreground-muted">{busy}</p>}
      {error && <p className="text-danger">{error}</p>}
      {note && <p className="text-foreground-muted">{note}</p>}
      <p className="text-[11px] text-foreground-muted">MP4 or MOV up to 50 MB. Clips that aren&apos;t vertical are cropped to fill the 9:16 frame.</p>
    </div>
  );
}

/** Length and frame size, read in the browser before uploading. */
function readVideo(file: File): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (r: { duration: number; width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(r);
    };
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? { duration: Math.round(v.duration * 1000) / 1000, width: v.videoWidth, height: v.videoHeight } : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 20000);
    v.src = url;
  });
}

