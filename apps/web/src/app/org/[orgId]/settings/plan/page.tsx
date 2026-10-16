import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { serverToday } from "@/lib/server-today";
import {
  GRACE_DAYS,
  PLAN_DEFAULTS,
  UNLIMITED_SEATS,
  addDays,
  billingState,
  formatBytes,
  formatSeats,
} from "@/lib/plans";
import { getOrgPayments, getOrgUsage } from "./plan-data";

export default function PlanPage({ params }: { params: Promise<{ orgId: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Settings</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Plan &amp; usage</h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Your AutoCut plan, what it includes, and how much of it you&apos;re using. AI generation is billed by your
          providers on your own keys, separately from this plan.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-border" />}>
        <GatedPlan params={params} />
      </Suspense>
    </main>
  );
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Meter({ label, used, cap, display, hint }: { label: string; used: number; cap: number | null; display: string; hint?: string }) {
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-foreground-muted">{display}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        {cap !== null && (
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct >= 90 ? "bg-danger/70" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
    </div>
  );
}

async function GatedPlan({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgAdmin(orgId);
  const [usage, payments] = await Promise.all([getOrgUsage(orgId), getOrgPayments(orgId)]);
  if (!usage) return null;

  const today = serverToday();
  const plan = PLAN_DEFAULTS[usage.plan];
  const state = billingState(usage.paid_until, today);
  const storageCap = usage.storage_quota_gb === null ? null : usage.storage_quota_gb * 1e9;

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{plan.label}</h2>
          {plan.priceUsd ? <span className="text-sm text-foreground-muted">${plan.priceUsd} / month</span> : null}
        </div>
        {usage.paid_until ? (
          <p className={`text-sm ${state === "grace" || state === "lapsed" ? "text-danger" : ""}`}>
            {state === "lapsed"
              ? `Ended on ${formatDay(usage.paid_until)}. Generation is off until it's renewed; everything you've made is still here.`
              : state === "grace"
                ? `Payment was due on ${formatDay(usage.paid_until)}. Generation stops on ${formatDay(addDays(usage.paid_until, GRACE_DAYS + 1))} unless it's renewed.`
                : `Paid until ${formatDay(usage.paid_until)}.`}
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">No renewal date set.</p>
        )}
        <p className="text-xs text-foreground-muted">To renew or change plan, contact AutoCut. Payments are recorded by our team.</p>
      </section>

      <section className="card flex flex-col gap-5 p-5">
        <h2 className="text-sm font-semibold">Usage</h2>
        <Meter
          label="Seats"
          used={usage.seats_used}
          cap={usage.seat_cap !== null && usage.seat_cap < UNLIMITED_SEATS ? usage.seat_cap : null}
          display={`${usage.seats_used} of ${formatSeats(usage.seat_cap)}`}
          hint="Active members plus pending invites."
        />
        <Meter
          label="Brands"
          used={usage.brands_used}
          cap={usage.brand_cap}
          display={`${usage.brands_used} of ${usage.brand_cap ?? "unlimited"}`}
          hint="Archived brands don't count."
        />
        <Meter
          label="Storage"
          used={usage.storage_bytes}
          cap={storageCap}
          display={`${formatBytes(usage.storage_bytes)} of ${usage.storage_quota_gb === null ? "unlimited" : `${usage.storage_quota_gb} GB`}`}
          hint="Images, videos, voiceovers and uploads. Replaced (archived) files are deleted 90 days after they're replaced, unless saved to the Library."
        />
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Payment history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-foreground-muted">No payments recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{formatDay(p.paid_on)}</span>
                <span className="tabular-nums">
                  {p.currency} {p.amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
                </span>
                <span className="text-foreground-muted">covers until {formatDay(p.period_end)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
