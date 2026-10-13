"use client";

import { useState, useTransition } from "react";
import type { ApiKeyProvider } from "@/app/org/[orgId]/settings/keys/keys-data";
import type { BrandSecretRow } from "./keys-data";
import { saveBrandProviderKey } from "./keys-actions";
import { buttonVariants } from "@/components/button";

const API_KEY_PROVIDERS: { id: ApiKeyProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "kie", label: "kie.ai" },
  { id: "fal", label: "fal.ai" },
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "twelvelabs", label: "TwelveLabs" },
  { id: "pexels", label: "Pexels" },
];

export function KeysScreen({
  orgId,
  brandId,
  secrets,
}: {
  orgId: string;
  brandId: string;
  secrets: BrandSecretRow[];
}) {
  const byProvider = Object.fromEntries(secrets.map((s) => [s.provider, s]));

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
        A key saved here is used only for this brand&apos;s own generations.
        Leave a provider blank to keep using the org&apos;s own key for it.
      </div>

      {API_KEY_PROVIDERS.map((p) => (
        <ProviderRow
          key={p.id}
          orgId={orgId}
          brandId={brandId}
          provider={p.id}
          label={p.label}
          existing={byProvider[p.id]}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  orgId,
  brandId,
  provider,
  label,
  existing,
}: {
  orgId: string;
  brandId: string;
  provider: ApiKeyProvider;
  label: string;
  existing?: BrandSecretRow;
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
      const result = await saveBrandProviderKey(orgId, brandId, provider, value);
      if (result.ok) {
        setValue("");
        setEditing(false);
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
        {!existing && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            Add a brand-specific key
          </button>
        )}
      </div>

      {!existing && !editing && (
        <p className="mt-1 text-xs text-foreground-muted">
          Using the org&apos;s own key, if one is saved.
        </p>
      )}

      {editing && (
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            autoComplete="off"
            placeholder={`Paste this brand's ${label} API key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isPending}
            className="field flex-1"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className={buttonVariants.primary}
          >
            {isPending ? "Verifying..." : "Verify & save"}
          </button>
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
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
