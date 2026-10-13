"use client";

import { useEffect, useState } from "react";
import { listLibraryImagesForPanel, type MiniLibraryImage } from "@/app/org/[orgId]/library/library-actions";

/** data-transfer mime type native drag-and-drop uses to carry the dragged library asset's id — shared constant between the drag source (here) and every drop target (SceneImageCard in scene-images-step.tsx). */
export const LIBRARY_ASSET_DRAG_TYPE = "application/x-library-asset-id";

/**
 * Slide-out mini-library browser, opened from inside Scene images
 * (spec §5.9: "Drag a library item into a scene"). Design decision:
 * a separate /library page can't be a meaningful drag source for a
 * drop target on the ad's Studio page — dragging across a full page
 * navigation isn't a thing browsers support, and even if it were, the
 * editor would lose sight of the scene cards they're dragging onto.
 * This panel instead renders alongside the scene list on the SAME
 * page, so both the scene cards and a scrollable grid of library
 * images are visible at once and a native HTML5 drag can go straight
 * from one to the other. Chosen over a full-screen modal for the same
 * reason: the scene cards need to stay visible underneath/beside it,
 * not be covered.
 */
export function LibraryPanel({ orgId, isOpen, onClose }: { orgId: string; isOpen: boolean; onClose: () => void }) {
  const [images, setImages] = useState<MiniLibraryImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // Deliberately does not reset images to null before fetching —
    // setting state synchronously in an effect body (rather than
    // inside the async callback) is the exact cascading-render
    // anti-pattern ADR 002 item 26 already found and fixed elsewhere
    // in this codebase. The stale list from a previous open stays on
    // screen until the fresh fetch resolves, which is a harmless
    // flash of old data, not a correctness issue.
    listLibraryImagesForPanel(orgId)
      .then((result) => {
        if (!cancelled) setImages(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the library.");
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="card-inset flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Library — drag an image onto a scene below</span>
        <button type="button" onClick={onClose} className="text-xs text-foreground-muted hover:text-foreground">
          Close
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {images === null ? (
        <p className="text-xs text-foreground-muted">Loading...</p>
      ) : images.length === 0 ? (
        <p className="text-xs text-foreground-muted">No images saved to the library yet.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img) => (
            <div
              key={img.asset_id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LIBRARY_ASSET_DRAG_TYPE, img.asset_id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={img.name ?? "Library image"}
              className="h-20 w-20 shrink-0 cursor-grab overflow-hidden rounded-lg border border-border-strong active:cursor-grabbing"
            >
              {img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.url} alt={img.name ?? "Library image"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-border text-[10px] text-foreground-muted">
                  N/A
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
