"use client";

import { useState, useTransition } from "react";
import { requestMagicLink } from "./actions";

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
      <p role="status">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form action={onSubmit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        disabled={isPending}
      />
      <button type="submit" disabled={isPending}>
        {isPending ? "Sending…" : "Send sign-in link"}
      </button>
      {message?.kind === "error" && (
        <p role="alert">{message.text}</p>
      )}
    </form>
  );
}
