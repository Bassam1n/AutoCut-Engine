"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar across the top that starts the moment an in-app link is
 * clicked and finishes when the new page is on screen, so a click
 * always shows that something is happening even while the server is
 * still rendering the next page.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      timers.current.forEach(clearTimeout);
      setState("loading");
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The route changed: finish the bar, then hide it.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => (s === "loading" ? "done" : s));
    timers.current = [window.setTimeout(() => setState("idle"), 400)];
  }, [pathname, searchParams]);

  if (state === "idle") return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5">
      <div
        className={`h-full bg-accent shadow-[0_0_8px_var(--color-accent)] ${
          state === "loading" ? "animate-[nav-progress_8s_cubic-bezier(.1,.7,.3,1)_forwards]" : "w-full opacity-0 transition-opacity duration-300"
        }`}
      />
    </div>
  );
}
