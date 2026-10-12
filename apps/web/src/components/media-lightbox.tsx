"use client";

import { useEffect } from "react";

/**
 * Full-size image/video review overlay — click a thumbnail anywhere
 * (Scene images, Scene videos) to open the real asset at full size
 * instead of squinting at an 80-96px thumbnail. Deliberately a new
 * component rather than reusing components/modal.tsx: that one caps
 * at max-w-sm for small form-style dialogs and would crop media badly.
 * Closes on backdrop click, the ✕, or Escape.
 */
export function MediaLightbox({
  kind,
  url,
  alt,
  onClose,
}: {
  kind: "image" | "video";
  url: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 text-2xl text-white/80 hover:text-white"
        aria-label="Close"
      >
        ✕
      </button>
      <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={alt} className="max-h-[90vh] max-w-full rounded-lg object-contain" />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[90vh] max-w-full rounded-lg"
          >
            Your browser does not support video playback.
          </video>
        )}
      </div>
    </div>
  );
}
