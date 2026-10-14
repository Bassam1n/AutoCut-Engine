"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

const VALID_TYPES: EmailOtpType[] = ["invite", "magiclink", "signup", "recovery", "email_change", "email"];

export function AcceptForm() {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash") ?? "";
  const rawType = params.get("type") ?? "";
  const type = (VALID_TYPES as string[]).includes(rawType) ? (rawType as EmailOtpType) : null;

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!tokenHash || !type) {
    return <Invalid reason="This link is incomplete — it may have been cut off when it was shared." />;
  }

  function continueSignIn() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash });
      if (verifyError) {
        setError(
          "This link has expired or was already used. Ask for a new one, or request a sign-in link with your email on the login page."
        );
        return;
      }
      // First sign-in: attach the pending invite (org + role). Harmless
      // no-op error on every later sign-in — see auth/callback/route.ts.
      await supabase.rpc("accept_invite");
      router.push("/");
      router.refresh();
    });
  }

  if (error) return <Invalid reason={error} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">
        Press continue to sign in on this device.
      </p>
      <button type="button" onClick={continueSignIn} disabled={isPending} className="btn-primary w-full">
        {isPending ? "Signing in..." : "Continue"}
      </button>
    </div>
  );
}

function Invalid({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-danger">{reason}</p>
      <Link href="/login" className="btn-secondary w-full">
        Go to the login page
      </Link>
    </div>
  );
}
