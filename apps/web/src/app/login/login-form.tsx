"use client";

import { useState, useTransition } from "react";
import { requestMagicLink } from "./actions";
import { buttonVariants } from "@/components/button";

export function LoginForm() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "sent" } | { kind: "error"; text: string } | null
  >(null);

  function onSubmit(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await requestMagicLink(formData);
      if (result.ok) {
        setMessage({ kind: "sent" });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  if (message?.kind === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <p className="text-sm font-medium">Check your email</p>
        <p className="text-sm text-foreground-muted">
          We sent a sign-in link. It&apos;ll expire shortly, so use it soon.
        </p>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@agency.com"
          required
          autoComplete="email"
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-foreground-muted focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className={buttonVariants.primary}
      >
        {isPending ? "Sending…" : "Send sign-in link"}
      </button>

      {message?.kind === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
