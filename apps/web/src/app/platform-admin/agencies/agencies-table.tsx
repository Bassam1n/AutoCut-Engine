"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { RegisterAgencyForm } from "../register-agency-form";
import { PLANS, PLAN_LABELS, agencyIssues, agencyStatus, type AgencyStatus, type AgencySummary, type Plan } from "../model";
import { PlanBadge, StatusBadge, formatRelative, formatUsd } from "../ui";

type SortKey = "name" | "created" | "spend" | "activity" | "seats";

const STATUS_FILTERS: { value: AgencyStatus | "all" | "attention"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "attention", label: "Needs attention" },
  { value: "active", label: "Active" },
  { value: "invite_pending", label: "Invite pending" },
  { value: "paused", label: "Paused" },
  { value: "suspended", label: "Suspended" },
];

export function AgenciesTable({ agencies, openNew, now }: { agencies: AgencySummary[]; openNew: boolean; now: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");
  const [plan, setPlan] = useState<Plan | "all">("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [showNew, setShowNew] = useState(openNew);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = agencies.filter((a) => {
      if (q && !a.org_name.toLowerCase().includes(q) && !(a.owner_email ?? "").toLowerCase().includes(q)) return false;
      if (plan !== "all" && a.plan !== plan) return false;
      if (status === "attention") return !a.suspended_at && agencyIssues(a).length > 0;
      if (status !== "all" && agencyStatus(a) !== status) return false;
      return true;
    });
    const by: Record<SortKey, (a: AgencySummary, b: AgencySummary) => number> = {
      name: (a, b) => a.org_name.localeCompare(b.org_name),
      created: (a, b) => b.created_at.localeCompare(a.created_at),
      spend: (a, b) => b.spend_30d - a.spend_30d,
      activity: (a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""),
      seats: (a, b) => b.members_active - a.members_active,
    };
    return [...filtered].sort(by[sort]);
  }, [agencies, query, status, plan, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by agency or owner email"
          aria-label="Search agencies"
          className="field min-w-56 flex-1"
        />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="field">
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by plan" value={plan} onChange={(e) => setPlan(e.target.value as Plan | "all")} className="field">
          <option value="all">All plans</option>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="field">
          <option value="created">Newest first</option>
          <option value="name">Name</option>
          <option value="spend">Spend (30 days)</option>
          <option value="activity">Last active</option>
          <option value="seats">Seats used</option>
        </select>
        <button type="button" onClick={() => setShowNew(true)} className="btn-primary">
          New agency
        </button>
      </div>

      <div className="card relative overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground-muted">
              <th className="px-4 py-3 font-medium">Agency</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 text-right font-medium">Seats</th>
              <th className="px-4 py-3 text-right font-medium">Brands</th>
              <th className="px-4 py-3 text-right font-medium">Ads (30d)</th>
              <th className="px-4 py-3 text-right font-medium">Spend (30d)</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-foreground-muted">
                  {agencies.length === 0 ? "No agencies yet. Register your first one." : "No agencies match these filters."}
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const issues = agencyIssues(a);
                return (
                  <tr
                    key={a.org_id}
                    onClick={() => router.push(`/platform-admin/agencies/${a.org_id}`)}
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-border/25"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/platform-admin/agencies/${a.org_id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {a.org_name}
                      </Link>
                      <div className="text-xs text-foreground-muted">{a.owner_email ?? "No owner yet"}</div>
                      {issues.length > 0 && !a.suspended_at && (
                        <div className="mt-0.5 text-xs text-danger">{issues[0]}{issues.length > 1 ? ` +${issues.length - 1} more` : ""}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={agencyStatus(a)} />
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={a.plan} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {a.members_active}
                      <span className="text-foreground-muted"> / {a.seat_cap ?? "none"}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.brands_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.ads_30d}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatUsd(a.spend_30d)}</td>
                    <td className="px-4 py-3 text-foreground-muted">{formatRelative(a.last_activity, now)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">
        Showing {rows.length} of {agencies.length} agencies.
      </p>

      {showNew && (
        <Modal
          title="New agency"
          onClose={() => {
            setShowNew(false);
            router.replace("/platform-admin/agencies");
            router.refresh();
          }}
        >
          <RegisterAgencyForm />
        </Modal>
      )}
    </div>
  );
}
