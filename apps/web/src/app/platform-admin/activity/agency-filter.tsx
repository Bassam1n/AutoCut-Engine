"use client";

import { useRouter } from "next/navigation";

export function AgencyFilter({ agencies, selected }: { agencies: { id: string; name: string }[]; selected: string | null }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 self-start text-sm">
      <span className="text-foreground-muted">Agency</span>
      <select
        value={selected ?? ""}
        onChange={(e) => router.push(e.target.value ? `/platform-admin/activity?agency=${e.target.value}` : "/platform-admin/activity")}
        className="field field-sm"
      >
        <option value="">All agencies</option>
        {agencies.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
