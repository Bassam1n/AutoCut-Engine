"use client";

import { LoadingIndicator } from "./loading-indicator";

/**
 * Wraps the "button that shows a pending state while an action runs"
 * pattern that was previously hand-written per button (isPending ?
 * <LoadingIndicator /> : label), with easy opportunities to forget
 * the loading state, use the wrong className, or get the contrast
 * wrong. Using this instead of a raw <button> makes the processing
 * animation automatic and consistent everywhere.
 */
export function AsyncButton({
  isPending,
  pendingLabel,
  onClick,
  type = "button",
  className,
  disabled,
  children,
}: {
  isPending: boolean;
  /** Shown with the animated dots while isPending is true — defaults to children if omitted. */
  pendingLabel?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  className: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isPending || disabled}
      className={`${className} disabled:opacity-60`}
    >
      {isPending ? <LoadingIndicator label={pendingLabel ?? "Working..."} /> : children}
    </button>
  );
}
