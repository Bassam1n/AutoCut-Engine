"use client";

import type { ApiKeyProvider } from "./keys-data";

/**
 * The key input(s) for one provider row. Most providers take a single
 * key; Higgsfield's credential is a key ID plus a secret, collected as
 * two fields and stored as one secret value "KEY_ID:KEY_SECRET" (the
 * exact form its Authorization header uses). `value` is always that
 * combined string, so the save actions stay provider-agnostic.
 */
export function ProviderKeyFields({
  provider,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  provider: ApiKeyProvider;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  if (provider !== "higgsfield") {
    return (
      <input
        type="password"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="field flex-1"
      />
    );
  }

  const sep = value.indexOf(":");
  const keyId = sep === -1 ? value : value.slice(0, sep);
  const keySecret = sep === -1 ? "" : value.slice(sep + 1);
  const combine = (id: string, secret: string) => (id || secret ? `${id}:${secret}` : "");

  return (
    <div className="flex flex-1 flex-col gap-2 sm:flex-row">
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} key ID`}
        placeholder="Key ID"
        value={keyId}
        // A colon separates the two parts, so it can't be part of the ID.
        onChange={(e) => onChange(combine(e.target.value.replace(/:/g, "").trim(), keySecret))}
        disabled={disabled}
        className="field flex-1"
      />
      <input
        type="password"
        autoComplete="off"
        aria-label={`${label} key secret`}
        placeholder="Key secret"
        value={keySecret}
        onChange={(e) => onChange(combine(keyId, e.target.value.trim()))}
        disabled={disabled}
        className="field flex-1"
      />
    </div>
  );
}

/** Help line under a provider row, where one is useful. */
export function providerKeyHint(provider: ApiKeyProvider): string | null {
  if (provider === "higgsfield") {
    return "Create an API key at cloud.higgsfield.ai and paste both its key ID and its secret.";
  }
  return null;
}
