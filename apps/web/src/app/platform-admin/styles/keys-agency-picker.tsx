"use client";

import { useRouter } from "next/navigation";

export function KeysAgencyPicker({
  agencies,
  selected,
  hasImageKey,
}: {
  agencies: { id: string; name: string }[];
  selected: string;
  hasImageKey: boolean;
}) {
  const router = useRouter();
  return (
    <div className="card-inset flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-foreground-muted">Generate using the keys of</span>
        <select
          value={selected}
          onChange={(e) => router.push(`/platform-admin/styles?org=${e.target.value}`)}
          className="field field-sm"
        >
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {!hasImageKey && (
        <span className="text-xs text-danger">This agency has no kie.ai or fal.ai key saved. Pick another, or add one in its Org-wide keys.</span>
      )}
      <span className="text-xs text-foreground-muted">Spend is recorded on that agency.</span>
    </div>
  );
}
