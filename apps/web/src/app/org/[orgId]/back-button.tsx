"use client";

import { Suspense } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Goes back to wherever the user actually came from (browser history),
 * rather than a hardcoded parent route — simpler and more honest than
 * guessing a "logical" parent, and correct even when a page is reached
 * from more than one place. Falls back to the current path's own
 * parent segment (one level up) when there's no history to go back to
 * — opening the page directly in a new tab, for example — so "Back"
 * never dead-ends on an empty history stack.
 *
 * Exported as BackButton (wrapped in its own Suspense boundary) rather
 * than the raw implementation: usePathname() is a dynamic client hook,
 * so Cache Components requires it to sit behind a boundary wherever
 * it's used — wrapping once here means every call site just drops in
 * <BackButton /> without re-adding that boilerplate per page.
 */
export function BackButton() {
  return (
    <Suspense fallback={<BackButtonSkeleton />}>
      <BackButtonImpl />
    </Suspense>
  );
}

function BackButtonSkeleton() {
  return <div className="mb-3 h-5 w-14 animate-pulse rounded bg-border" />;
}

function BackButtonImpl() {
  const router = useRouter();
  const pathname = usePathname();

  function onClick() {
    if (window.history.length > 1) {
      router.back();
    } else {
      const parent = pathname.split("/").slice(0, -1).join("/");
      router.push(parent || "/");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
    >
      <span aria-hidden="true">←</span> Back
    </button>
  );
}
