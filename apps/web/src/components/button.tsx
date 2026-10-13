/**
 * Shared button shape (reference design: pill radius, soft drop
 * shadow on every state, not just hover). Introduced alongside the
 * visual refresh — existing call sites still pass their own className
 * to AsyncButton/<button> directly; new and updated call sites use
 * these variant classes instead of hand-writing the same Tailwind
 * string again.
 */
export const buttonVariants = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-[var(--shadow-soft)] transition-all hover:brightness-105 hover:shadow-[var(--shadow-raised)] disabled:opacity-60 disabled:shadow-none",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-border-strong bg-background-raised px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-soft)] transition-all hover:bg-border/30 disabled:opacity-60 disabled:shadow-none",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:bg-border/40 disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger shadow-[var(--shadow-soft)] transition-all hover:brightness-95 disabled:opacity-60 disabled:shadow-none",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

/** Same sizing scale, smaller padding/text — for compact per-card actions (e.g. a scene card's "Regenerate"). */
export const buttonVariantsSm = {
  primary:
    "inline-flex items-center justify-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink shadow-[var(--shadow-soft)] transition-all hover:brightness-105 disabled:opacity-60 disabled:shadow-none",
  secondary:
    "inline-flex items-center justify-center gap-1 rounded-full border border-border-strong bg-background-raised px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-soft)] transition-all hover:bg-border/30 disabled:opacity-60 disabled:shadow-none",
  ghost:
    "inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-border/40 disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-1 rounded-full border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger transition-all hover:brightness-95 disabled:opacity-60",
} as const;
