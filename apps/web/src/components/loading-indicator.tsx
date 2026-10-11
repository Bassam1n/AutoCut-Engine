"use client";

/**
 * Shared "working" indicator for any async generation — Claude-style
 * animated dots plus a label, so the screen never looks stalled while
 * a Claude call or image generation runs in the background. Meant to
 * replace plain "Generating..." button-label swaps anywhere a
 * generation can take more than a second or two.
 */
export function LoadingIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-foreground-muted">
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
      </span>
      {label}
    </span>
  );
}

/** Full-width skeleton block variant, for a step that's loading its initial content rather than reacting to a button click. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <LoadingIndicator label={label} />
    </div>
  );
}
