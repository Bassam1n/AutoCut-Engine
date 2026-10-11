"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Fallback for sign-in links that used the implicit flow instead of PKCE
 * — the tokens arrive in the URL FRAGMENT (#access_token=...), which
 * route.ts can never see server-side (fragments are never sent in an
 * HTTP request at all, that's standard browser behavior, not a Next.js
 * or Supabase quirk). This page only renders when route.ts found no
 * `?code=` param, and does the equivalent exchange client-side instead:
 * reads the fragment, calls setSession() directly, then redirects.
 *
 * Real sign-in links from this app's own /login form use
 * @supabase/ssr's browser/server clients, which default to PKCE (see
 * node_modules/@supabase/ssr/dist/main/createBrowserClient.js) and
 * should never hit this path. This exists because a manually generated
 * link via the plain @supabase/supabase-js admin client (used once to
 * unblock testing while Supabase's email sender was rate-limited)
 * defaults to the implicit flow instead — confirmed by inspecting
 * GoTrueClient.js's own default (`flowType: 'implicit'`) after seeing a
 * real redirect land here with tokens in the fragment instead of a code
 * param. Kept as a permanent fallback rather than a one-off fix, since
 * nothing stops a future manually-generated link (or a different
 * Supabase client somewhere) from producing the same shape again.
 */
export function ImplicitFlowBridge({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<"working" | "error">("working");

  useEffect(() => {
    // The whole body runs as a genuinely async task (not just a .then()
    // tacked onto synchronous work) so every setState call — including
    // the "no hash" / "missing tokens" early-outs — happens in its own
    // microtask rather than synchronously within the effect's call
    // frame, per the react-hooks/set-state-in-effect rule.
    let cancelled = false;

    async function run() {
      await Promise.resolve();
      if (cancelled) return;

      const hash = window.location.hash;
      if (!hash) {
        setState("error");
        return;
      }

      const params = new URLSearchParams(hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        setState("error");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }

      await supabase.rpc("accept_invite");
      if (cancelled) return;

      router.replace(next);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  if (state === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-foreground-muted">
          That sign-in link is invalid or expired.{" "}
          <a href="/login" className="font-medium text-accent hover:underline">
            Try again
          </a>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-foreground-muted">Signing you in…</p>
    </main>
  );
}
