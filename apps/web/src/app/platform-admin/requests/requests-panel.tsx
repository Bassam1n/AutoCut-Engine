"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AccessRequest } from "../data";
import { formatRelative } from "../ui";
import { setRequestStatus } from "./actions";

const STATUSES: { id: AccessRequest["status"]; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "closed", label: "Closed" },
];

export function RequestsPanel({ requests }: { requests: AccessRequest[] }) {
  const [filter, setFilter] = useState<AccessRequest["status"] | "all">("new");
  const shown = requests.filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {([{ id: "all" as const, label: "All" }, ...STATUSES]).map((s) => {
          const count =
            s.id === "all" ? requests.length : requests.filter((r) => r.status === s.id).length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setFilter(s.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === s.id ? "bg-accent-soft text-accent" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {s.label} ({count})
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="card px-5 py-10 text-center text-sm text-foreground-muted">
          {filter === "new" ? "No new requests. They'll show up here as soon as someone submits the form." : "Nothing here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: AccessRequest }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(status: AccessRequest["status"]) {
    setError(null);
    startTransition(async () => {
      const result = await setRequestStatus(request.id, status);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{request.agency}</p>
          <p className="text-sm text-foreground-muted">
            {request.name} · <a className="hover:underline" href={`mailto:${request.email}`}>{request.email}</a>
            {request.editors ? ` · ${request.editors} editor${request.editors === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <span className="text-xs text-foreground-muted">{formatRelative(request.created_at)}</span>
      </div>
      {request.note && <p className="whitespace-pre-wrap text-sm">{request.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.filter((s) => s.id !== request.status).map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={isPending}
            onClick={() => move(s.id)}
            className="btn-secondary btn-xs"
          >
            Mark {s.label.toLowerCase()}
          </button>
        ))}
        {request.status === "new" && (
          <a href={`/platform-admin/agencies?new=1`} className="btn-primary btn-xs">
            Register agency
          </a>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </li>
  );
}
