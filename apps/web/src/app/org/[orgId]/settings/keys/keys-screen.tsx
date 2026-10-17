"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ApiKeyProvider, OrgSecretRow } from "./keys-data";
import { saveProviderKey } from "./keys-actions";
import { sameOriginPath } from "@/lib/safe-next";
import { buttonVariants } from "@/components/button";
import { ProviderKeyFields, providerKeyHint } from "./provider-key-fields";

/**
 * When linked to with ?returnTo=<path>, shows a banner so the editor
 * knows saving a key will bring them back to where they came from —
 * the model picker's "no key saved, add one" redirect relies on this.
 */
function ReturnToBanner() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  if (!returnTo) return null;

  return (
    <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
      Add the key below, then you&apos;ll be able to continue where you left off.
    </div>
  );
}

const API_KEY_PROVIDERS: { id: ApiKeyProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "kie", label: "kie.ai" },
  { id: "fal", label: "fal.ai" },
  { id: "higgsfield", label: "Higgsfield" },
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "twelvelabs", label: "TwelveLabs" },
  { id: "pexels", label: "Pexels" },
];

const OAUTH_PROVIDERS = [
  { id: "heygen", label: "HeyGen" },
  { id: "xai", label: "xAI (Grok)" },
];

export function KeysScreen({
  orgId,
  secrets,
}: {
  orgId: string;
  secrets: OrgSecretRow[];
}) {
  const byProvider = Object.fromEntries(secrets.map((s) => [s.provider, s]));

  return (
    <div className="flex flex-col gap-3">
      <Suspense fallback={null}>
        <ReturnToBanner />
      </Suspense>

      {API_KEY_PROVIDERS.map((p) => (
        <ProviderRow key={p.id} orgId={orgId} provider={p.id} label={p.label} existing={byProvider[p.id]} />
      ))}

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Connected via subscription (not an API key)
        </p>
        {OAUTH_PROVIDERS.map((p) => (
          <div
            key={p.id}
            className="card mb-2 flex items-center justify-between p-4"
          >
            <span className="font-medium">{p.label}</span>
            <button
              type="button"
              disabled
              title="OAuth connect is not built yet"
              className="btn-secondary"
            >
              Connect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderRow({
  orgId,
  provider,
  label,
  existing,
}: {
  orgId: string;
  provider: ApiKeyProvider;
  label: string;
  existing?: OrgSecretRow;
}) {
  const [editing, setEditing] = useState(!existing);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onSave() {
    setError(null);
    if (!value.trim()) {
      setError("Enter a key first.");
      return;
    }
    startTransition(async () => {
      const result = await saveProviderKey(orgId, provider, value);
      if (result.ok) {
        setValue("");
        setEditing(false);
        const returnTo = sameOriginPath(new URLSearchParams(window.location.search).get("returnTo"), window.location.origin);
        if (returnTo) router.push(returnTo);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {existing && !editing && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground-muted">
              •••• {existing.last4}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                existing.verified_at
                  ? "bg-accent-soft text-accent"
                  : "bg-danger-soft text-danger"
              }`}
            >
              {existing.verified_at ? "Verified" : "Not verified"}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Replace
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <ProviderKeyFields
            provider={provider}
            label={label}
            placeholder={`Paste your ${label} API key`}
            value={value}
            onChange={setValue}
            disabled={isPending}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className={buttonVariants.primary}
          >
            {isPending ? "Verifying..." : "Verify & save"}
          </button>
          {existing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setValue("");
              }}
              disabled={isPending}
              className="btn-secondary"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {editing && providerKeyHint(provider) && (
        <p className="mt-2 text-xs text-foreground-muted">{providerKeyHint(provider)}</p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
