"use client";

import Link from "next/link";
import type { ModelOption } from "@/lib/providers/models-data";

/**
 * Picks a provider+model for a generation task. Every registered
 * model shows regardless of whether a key is saved for its provider —
 * picking one without a key surfaces an inline "Add key" link
 * (returnTo back here) rather than hiding the option, so the editor
 * can see what's available and knows exactly what to go set up.
 */
export function ModelPicker({
  orgId,
  options,
  providersWithKeys,
  value,
  onChange,
  returnToPath,
}: {
  orgId: string;
  options: ModelOption[];
  providersWithKeys: Set<string>;
  value: { provider: string; endpoint: string } | null;
  onChange: (option: ModelOption) => void;
  returnToPath: string;
}) {
  const selected = options.find(
    (o) => o.provider === value?.provider && o.endpoint === value?.endpoint
  );
  const hasKey = selected ? providersWithKeys.has(selected.provider) : true;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium">Model</label>
      <select
        value={selected ? `${selected.provider}::${selected.endpoint}` : ""}
        onChange={(e) => {
          const [provider, endpoint] = e.target.value.split("::");
          const option = options.find((o) => o.provider === provider && o.endpoint === endpoint);
          if (option) onChange(option);
        }}
        className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
      >
        <option value="" disabled>
          Select a model
        </option>
        {options.map((o) => (
          <option key={`${o.provider}::${o.endpoint}`} value={`${o.provider}::${o.endpoint}`}>
            {o.name} ({o.provider}){providersWithKeys.has(o.provider) ? "" : " — no key saved"}
          </option>
        ))}
      </select>

      {selected && !hasKey && (
        <p className="text-xs text-danger">
          No {selected.provider} key saved for this org.{" "}
          <Link
            href={`/org/${orgId}/settings/keys?returnTo=${encodeURIComponent(returnToPath)}`}
            className="font-medium underline"
          >
            Add one
          </Link>{" "}
          to use this model.
        </p>
      )}
    </div>
  );
}
