"use client";

import { useState, useTransition } from "react";
import type { OrgSpendStatus, AuditLogRow } from "./spend-data";
import { resumeOrg } from "./spend-actions";

const AUDIT_ACTION_LABELS: Record<string, string> = {
  spend_guard_paused: "Spend guard paused the org",
  spend_guard_warn: "Spend guard warn threshold crossed",
  spend_guard_resumed: "Org resumed",
  member_invited: "Member invited",
  member_role_changed: "Member role changed",
  member_seat_activated: "Member seat activated",
  member_seat_deactivated: "Member seat deactivated",
  invite_revoked: "Invite revoked",
  seat_cap_changed: "Seat cap changed",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function SpendScreen({
  orgId,
  status,
  auditLog,
  canAdminister,
}: {
  orgId: string;
  status: OrgSpendStatus;
  auditLog: AuditLogRow[];
  canAdminister: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SpendStatusCard orgId={orgId} status={status} canAdminister={canAdminister} />
      {canAdminister && <AuditLogTable rows={auditLog} />}
    </div>
  );
}

function SpendStatusCard({
  orgId,
  status,
  canAdminister,
}: {
  orgId: string;
  status: OrgSpendStatus;
  canAdminister: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const fractionOfStop = status.stopUsd > 0 ? status.spend24h / status.stopUsd : 0;
  const barColor =
    fractionOfStop >= 1
      ? "bg-danger"
      : status.spend24h >= status.warnUsd
        ? "bg-amber-500"
        : "bg-accent";

  function onResume() {
    setError(null);
    startTransition(async () => {
      const result = await resumeOrg(orgId);
      if (result.ok) {
        setResumed(true);
      } else {
        setError(result.error);
      }
    });
  }

  const isPaused = status.paused && !resumed;

  return (
    <div className="rounded-xl border border-border bg-background-raised p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground-muted">
          Rolling 24 hour spend <span className="text-foreground-muted/60">(estimate)</span>
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            isPaused ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
          }`}
        >
          {isPaused ? "Paused" : "Active"}
        </span>
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight">
        ${status.spend24h.toFixed(2)}
      </p>
      <p className="text-xs text-foreground-muted">
        Warn at ${status.warnUsd.toFixed(2)} · stop at ${status.stopUsd.toFixed(2)}
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, fractionOfStop * 100)}%` }}
        />
      </div>

      {isPaused && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3">
          <p className="text-sm font-medium text-danger">
            This org is paused. New paid jobs are blocked until it&apos;s resumed; jobs already
            in flight are left to finish.
          </p>
          {status.pauseReason && (
            <p className="mt-1 text-xs text-danger/80">{status.pauseReason}</p>
          )}
          {canAdminister ? (
            <>
              <button
                type="button"
                onClick={onResume}
                disabled={isPending}
                className="mt-3 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "Resuming..." : "Resume spend"}
              </button>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </>
          ) : (
            <p className="mt-3 text-xs text-danger/80">
              Only an org owner or admin can resume spend.
            </p>
          )}
        </div>
      )}

      {!isPaused && status.pauseReason && (
        <p className="mt-3 text-xs text-foreground-muted">
          Last pause reason: {status.pauseReason}
        </p>
      )}

      <p className="mt-3 text-[10px] text-foreground-muted/60">
        Estimate only — see spend_events / price_table for the underlying rows.
      </p>
    </div>
  );
}

function AuditLogTable({ rows }: { rows: AuditLogRow[] }) {
  return (
    <div>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
        Audit log
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground-muted">Nothing recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background-raised px-4 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium">{auditActionLabel(row.action)}</p>
                <p className="text-xs text-foreground-muted">
                  {row.actor_email ?? "System"}
                  {row.target ? ` · ${row.target}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-xs text-foreground-muted">
                {new Date(row.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
