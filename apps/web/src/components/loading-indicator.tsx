"use client";

/**
 * Shared "working" indicator for any async generation — Claude-style
 * animated dots plus a label, so the screen never looks stalled while
 * a Claude call or image generation runs in the background. Meant to
 * replace plain "Generating..." button-label swaps anywhere a
 * generation can take more than a second or two.
 *
 * Inherits text color from its container (`currentColor`) rather than
 * hardcoding text-foreground-muted — the first version was nearly
 * invisible inside an accent-colored button (muted-gray dots on an
 * orange background), which read as plain static text rather than an
 * animation. `text-sm` was also dropped for the same reason: it was
 * shrinking everything down inside already-small buttons. Font size
 * and color now simply follow whatever the caller's own className set.
 */
export function LoadingIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
      {label}
    </span>
  );
}

/** Full-width skeleton block variant, for a step that's loading its initial content rather than reacting to a button click. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="card-inset flex flex-1 flex-col items-center justify-center gap-3 border-dashed py-16 text-center">
      <LoadingIndicator label={label} />
    </div>
  );
}
