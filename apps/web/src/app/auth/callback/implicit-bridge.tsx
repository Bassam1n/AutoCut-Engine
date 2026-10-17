"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

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
 *
 * The tokens in a fragment could have been planted by anyone who sent
 * the link, so nothing is installed until the person sees which account
 * the link signs into and presses Continue (same idea as /auth/accept),
 * and `next` is only ever followed within this site.
 */
export function ImplicitFlowBridge({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<"working" | "confirm" | "error">("working");
  const [email, setEmail] = useState<string | null>(null);
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);

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
      // Drop the tokens from the address bar either way.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);

      if (!access_token || !refresh_token) {
        setState("error");
        return;
      }

      // Ask Supabase who the token belongs to (verified server-side)
      // without installing it yet.
      const { data, error } = await createClient().auth.getUser(access_token);
      if (cancelled) return;
      if (error || !data.user) {
        setState("error");
        return;
      }
      setEmail(data.user.email ?? null);
      setTokens({ access_token, refresh_token });
      setState("confirm");
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function continueSignIn() {
    if (!tokens) return;
    setState("working");
    const supabase = createClient();
    const { error } = await supabase.auth.setSession(tokens);
    if (error) {
      setState("error");
      return;
    }
    await supabase.rpc("accept_invite");
    router.replace(safeNext(next, window.location.origin));
  }

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

  if (state === "confirm") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-sm text-foreground-muted">
            This link signs you in as{" "}
            <span className="font-medium text-foreground">{email ?? "an account without an email"}</span>.
          </p>
          <button
            type="button"
            onClick={continueSignIn}
            className="btn-primary w-full"
          >
            Continue
          </button>
          <p className="text-xs text-foreground-muted">
            Not you?{" "}
            <a href="/login" className="font-medium text-accent hover:underline">
              Sign in with your own email
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-foreground-muted">Signing you in…</p>
    </main>
  );
}
