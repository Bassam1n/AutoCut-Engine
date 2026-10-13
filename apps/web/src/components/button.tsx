/**
 * Shared button shape (reference design: pill radius, soft drop
 * shadow on every state, not just hover). The actual styles live in
 * globals.css (.btn-primary / .btn-secondary / .btn-ghost / .btn-danger,
 * plus .btn-sm / .btn-xs sizes) so plain className strings and these
 * constants render identically. Use either; prefer the constants in
 * components that already import them.
 */
export const buttonVariants = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

/** Same sizing scale, smaller padding/text — for compact per-card actions (e.g. a scene card's "Regenerate"). */
export const buttonVariantsSm = {
  primary: "btn-primary btn-sm",
  secondary: "btn-secondary btn-sm",
  ghost: "btn-ghost btn-sm",
  danger: "btn-danger btn-sm",
} as const;
