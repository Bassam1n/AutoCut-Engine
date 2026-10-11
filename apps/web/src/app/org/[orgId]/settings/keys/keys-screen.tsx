"use client";

import { useState, useTransition } from "react";
import type { ApiKeyProvider, OrgSecretRow } from "./keys-data";
import { saveProviderKey } from "./keys-actions";

const API_KEY_PROVIDERS: { id: ApiKeyProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "kie", label: "kie.ai" },
  { id: "fal", label: "fal.ai" },
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
            className="mb-2 flex items-center justify-between rounded-xl border border-border bg-background-raised p-4"
          >
            <span className="font-medium">{p.label}</span>
            <button
              type="button"
              disabled
              title="OAuth connect is not built yet"
              className="cursor-not-allowed rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium opacity-50"
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
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-background-raised p-4">
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
          <input
            type="password"
            autoComplete="off"
            placeholder={`Paste your ${label} API key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
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
              className="rounded-lg border border-border-strong px-3 py-2 text-sm font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
