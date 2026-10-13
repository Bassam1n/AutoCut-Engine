"use client";

import { useState, useTransition } from "react";
import { registerAgency, type RegisterAgencyResult } from "./actions";
import { buttonVariants } from "@/components/button";

export function RegisterAgencyForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RegisterAgencyResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(formData: FormData) {
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      setResult(await registerAgency(formData));
    });
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
          <p className="text-sm font-medium">Agency registered</p>
          <p className="mt-1 text-sm text-foreground-muted">
            Send this one-time sign-in link to the owner directly — it
            was not emailed automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            readOnly
            value={result.inviteLink}
            onFocus={(e) => e.currentTarget.select()}
            className="field field-sm flex-1 truncate font-mono"
          />
          <button
            type="button"
            onClick={() => copyLink(result.inviteLink)}
            className="btn-secondary shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setResult(null)}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          Register another agency
        </button>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orgName" className="text-sm font-medium">
          Agency / org name
        </label>
        <input
          id="orgName"
          name="orgName"
          type="text"
          placeholder="Acme Ads Co."
          required
          disabled={isPending}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ownerEmail" className="text-sm font-medium">
          Owner email
        </label>
        <input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          placeholder="owner@acmeads.com"
          required
          disabled={isPending}
          className="field"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className={buttonVariants.primary}
      >
        {isPending ? "Registering…" : "Register agency"}
      </button>

      {result && !result.ok && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {result.error}
        </p>
      )}
    </form>
  );
}
