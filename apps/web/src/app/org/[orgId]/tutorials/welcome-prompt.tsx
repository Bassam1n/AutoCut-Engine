"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FIRST_TUTORIAL_ID } from "@/lib/tutorials";
import { readDone } from "./tutorial-player";

const DISMISSED_KEY = "autocut-welcome-dismissed";

/** A one-time nudge towards the workspace tour, shown until it's watched or dismissed. */
export function WelcomePrompt({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      dismissed = true;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!dismissed && !readDone().has(FIRST_TUTORIAL_ID));
  }, []);

  if (!show || pathname.endsWith("/tutorials")) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Ignore: it simply shows again next time.
    }
    setShow(false);
  }

  return (
    <div className="card fixed bottom-5 right-5 z-40 flex w-[min(340px,calc(100vw-2.5rem))] flex-col gap-3 p-4 shadow-xl">
      <div>
        <p className="text-sm font-semibold">New to AutoCut?</p>
        <p className="mt-1 text-sm text-foreground-muted">
          Take a quick tour: click through the real app and see what every part is for.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/org/${orgId}/tutorials?play=${FIRST_TUTORIAL_ID}`} onClick={dismiss} className="btn-primary btn-sm">
          Start the tour
        </Link>
        <Link href={`/org/${orgId}/tutorials`} onClick={dismiss} className="btn-ghost btn-sm">
          All tutorials
        </Link>
        <button type="button" onClick={dismiss} className="ml-auto text-xs text-foreground-muted hover:underline">
          Not now
        </button>
      </div>
    </div>
  );
}
