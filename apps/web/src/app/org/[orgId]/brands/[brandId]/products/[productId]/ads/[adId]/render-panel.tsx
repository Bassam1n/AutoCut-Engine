"use client";

import { useState } from "react";
import JSZip from "jszip";
import { AsyncButton } from "@/components/async-button";
import type { ExportFormat } from "@/lib/auto-edit/exports/bundle";
import { requestRender, type RenderView } from "../auto-edit-actions";

/**
 * "Render MP4" (the final 1080x1920 video from the saved timeline, the
 * only video render on the worker) and "Export project for..." (the
 * timeline as a project for another editor, no Claude cost). Exports are
 * stored as separate files to stay under the storage upload limit and
 * zipped here, in the browser, the same way the asset downloads are.
 */

const FORMATS: { id: ExportFormat; label: string; contents: string }[] = [
  { id: "premiere", label: "Premiere Pro", contents: "FCP7 XML + SRT captions" },
  { id: "resolve", label: "DaVinci Resolve", contents: "FCPXML + OpenTimelineIO + SRT captions" },
  { id: "fcp", label: "Final Cut Pro", contents: "FCPXML + SRT captions" },
  { id: "capcut", label: "CapCut", contents: "numbered clips, transparent graphics + SRT captions" },
  { id: "concat", label: "Concat", contents: "native project + SRT captions" },
];
const LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label])) as Record<ExportFormat, string>;

export function RenderPanel({
  orgId,
  adId,
  adName,
  renders,
  blocked,
  timelineVersion,
  onStarted,
}: {
  orgId: string;
  adId: string;
  adName: string;
  renders: RenderView[];
  /** Why rendering is off right now (unsaved edits, problems, Auto-edit running), or null. */
  blocked: string | null;
  timelineVersion: number;
  onStarted: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("premiere");
  const [pending, setPending] = useState<"mp4" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = renders.find((r) => r.status === "queued" || r.status === "rendering") ?? null;

  async function start(kind: "mp4" | "export") {
    setError(null);
    setPending(kind);
    const res = await requestRender(orgId, adId, kind, kind === "export" ? format : undefined);
    setPending(null);
    if (!res.ok) return setError(res.error);
    onStarted();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <AsyncButton onClick={() => start("mp4")} isPending={pending === "mp4"} pendingLabel="Queuing..." disabled={Boolean(blocked || active || pending)} className="btn-primary btn-sm">
          Render MP4
        </AsyncButton>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <label className="flex flex-col gap-1 text-xs text-foreground-muted">
          Export project for...
          <select className="field field-sm" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <AsyncButton onClick={() => start("export")} isPending={pending === "export"} pendingLabel="Queuing..." disabled={Boolean(blocked || active || pending)} className="btn-secondary btn-sm">
          Export
        </AsyncButton>
      </div>
      <p className="text-[11px] text-foreground-muted">
        {blocked ?? `Uses timeline version ${timelineVersion}. ${FORMATS.find((f) => f.id === format)!.label}: ${FORMATS.find((f) => f.id === format)!.contents}, with the media in the zip. No Claude cost.`}
        {active && !blocked ? " One render or export runs at a time per ad." : ""}
      </p>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-sm text-danger">{error}</p>}

      {renders.length > 0 && (
        <ul className="flex flex-col gap-3">
          {renders.slice(0, 6).map((r) => <RenderRow key={r.id} render={r} adName={adName} stale={r.timelineVersion !== timelineVersion} />)}
        </ul>
      )}
    </div>
  );
}

function RenderRow({ render: r, adName, stale }: { render: RenderView; adName: string; stale: boolean }) {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const what = r.kind === "mp4" ? "MP4 · 1080×1920" : `Project for ${r.format ? LABEL[r.format] : "?"}`;
  const status = r.status === "queued" ? "Queued" : r.status === "rendering" ? (r.kind === "mp4" ? "Rendering..." : "Exporting...") : r.status === "failed" ? "Failed" : r.status === "cancelled" ? "Cancelled" : "Ready";

  async function downloadZip() {
    setZipping(true);
    setZipError(null);
    try {
      const folder = `autocut-${r.format}`;
      const zip = new JSZip();
      // Sequential: the media files are large and share one origin.
      for (const f of r.files) {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`Could not download ${f.path}.`);
        zip.file(`${folder}/${f.path}`, await res.arrayBuffer(), { binary: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(adName)}-${r.format}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setZipping(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{what}</span>
        <span className={r.status === "failed" ? "text-danger" : r.status === "succeeded" ? "" : "text-foreground-muted"}>{status}</span>
        <span className="text-foreground-muted">timeline v{r.timelineVersion}{stale ? " (edited since)" : ""}</span>
        <span className="text-foreground-muted">{new Date(r.createdAt).toLocaleString()}</span>
        {r.finishedAt && r.status === "succeeded" && (
          <span className="text-foreground-muted">{Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000))} s</span>
        )}
      </div>
      {r.status === "queued" && <p className="text-foreground-muted">Waiting for a free render slot. It starts automatically; you can leave this page.</p>}
      {r.status === "failed" && r.error && <p className="text-danger">{r.error}</p>}
      {r.status === "succeeded" && r.kind === "mp4" && r.videoUrl && (
        <figure className="flex flex-col gap-1">
          <video src={r.videoUrl} controls playsInline className="h-80 w-auto self-start rounded-lg border border-border-strong bg-black" />
          {r.downloadUrl && <a href={r.downloadUrl} className="btn-primary btn-sm self-start">Download MP4</a>}
        </figure>
      )}
      {r.status === "succeeded" && r.kind === "export" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={zipping || !r.files.length} onClick={downloadZip}>
              {zipping ? "Zipping..." : `Download zip (${mb(r.files.reduce((s, f) => s + f.bytes, 0))})`}
            </button>
            <span className="text-foreground-muted">{r.files.length} files</span>
          </div>
          {zipError && <p className="text-danger">{zipError}</p>}
        </div>
      )}
      {r.notes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-foreground-muted">Notes ({r.notes.length})</summary>
          <ul className="mt-1 list-disc pl-5">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
    </li>
  );
}

function mb(bytes: number) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} KB`;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad";
}
