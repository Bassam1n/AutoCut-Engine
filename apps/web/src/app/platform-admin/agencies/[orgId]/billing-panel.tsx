"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PLANS,
  PLAN_DEFAULTS,
  UNLIMITED_SEATS,
  addDays,
  addMonths,
  formatBytes,
  formatSeats,
  type Plan,
} from "@/lib/plans";
import type { AgencySummary } from "../../model";
import type { Payment } from "../../data";
import {
  recordPayment,
  setAgencyPlan,
  setPaidUntil,
  voidPayment,
  type ActionResult,
  type PaymentInput,
} from "../../agency-actions";

const METHOD_LABELS: Record<PaymentInput["method"], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  other: "Other",
};

const STATE_TEXT: Record<AgencySummary["billing_state"], { label: string; tone: string }> = {
  not_enforced: { label: "Not enforced", tone: "text-foreground-muted" },
  active: { label: "Paid", tone: "text-foreground" },
  due_soon: { label: "Due within 7 days", tone: "text-accent" },
  grace: { label: "Overdue, in grace period", tone: "text-danger" },
  lapsed: { label: "Lapsed, generation off", tone: "text-danger" },
};

function useAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }
  return { isPending, error, run };
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Meter({ label, used, cap, display }: { label: string; used: number; cap: number | null; display: string }) {
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const tone = pct >= 100 ? "bg-danger" : pct >= 90 ? "bg-danger/70" : "bg-accent";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-foreground-muted">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        {cap !== null && <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

export function BillingPanel({ agency, payments, today }: { agency: AgencySummary; payments: Payment[]; today: string }) {
  const state = STATE_TEXT[agency.billing_state];
  const seatsUsed = agency.members_active + agency.pending_invites;

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{PLAN_DEFAULTS[agency.plan].label} plan</h2>
            <p className="mt-1 text-sm">
              <span className={`font-medium ${state.tone}`}>{state.label}</span>
              {agency.paid_until && <span className="text-foreground-muted"> · paid until {formatDay(agency.paid_until)}</span>}
            </p>
            {agency.billing_state === "not_enforced" && (
              <p className="mt-1 text-xs text-foreground-muted">
                No paid until date, so nothing is blocked. Record a payment or start a trial to begin enforcing.
              </p>
            )}
          </div>
          <PaidUntilQuickActions agency={agency} today={today} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Meter
            label="Seats"
            used={seatsUsed}
            cap={agency.seat_cap !== null && agency.seat_cap < UNLIMITED_SEATS ? agency.seat_cap : null}
            display={`${seatsUsed} / ${formatSeats(agency.seat_cap)}`}
          />
          <Meter
            label="Brands"
            used={agency.brands_count}
            cap={agency.brand_cap}
            display={`${agency.brands_count} / ${agency.brand_cap ?? "Unlimited"}`}
          />
          <Meter
            label="Storage"
            used={agency.storage_bytes}
            cap={agency.storage_quota_gb === null ? null : agency.storage_quota_gb * 1e9}
            display={`${formatBytes(agency.storage_bytes)} / ${agency.storage_quota_gb === null ? "Unlimited" : `${agency.storage_quota_gb} GB`}`}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <PlanCard agency={agency} />
        <RecordPaymentCard agency={agency} today={today} />
      </div>

      <PaymentsTable orgId={agency.org_id} payments={payments} />
    </div>
  );
}

function PaidUntilQuickActions({ agency, today }: { agency: AgencySummary; today: string }) {
  const { isPending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {agency.billing_state === "not_enforced" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setPaidUntil(agency.org_id, addDays(today, 14)))}
            className="btn-secondary btn-sm"
          >
            Start 14 day trial
          </button>
        )}
        {agency.paid_until && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (window.confirm("Stop enforcing payment for this agency? Nothing will be blocked until you record a payment again.")) {
                run(() => setPaidUntil(agency.org_id, null));
              }
            }}
            className="btn-ghost btn-sm"
          >
            Stop enforcing
          </button>
        )}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function PlanCard({ agency }: { agency: AgencySummary }) {
  const { isPending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [plan, setPlan] = useState<Plan>(agency.plan);
  const [seats, setSeats] = useState(agency.seat_cap === null ? "" : String(agency.seat_cap));
  const [brands, setBrands] = useState(agency.brand_cap === null ? "" : String(agency.brand_cap));
  const [storage, setStorage] = useState(agency.storage_quota_gb === null ? "" : String(agency.storage_quota_gb));

  function pickPlan(next: Plan) {
    setPlan(next);
    const d = PLAN_DEFAULTS[next];
    setSeats(String(d.seats));
    setBrands(d.brands === null ? "" : String(d.brands));
    setStorage(String(d.storageGb));
    setSaved(false);
  }

  const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));

  return (
    <form
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => setAgencyPlan(agency.org_id, plan, toInt(seats), toInt(brands), toInt(storage)), () => setSaved(true));
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">Plan and limits</h2>
        <p className="mt-1 text-xs text-foreground-muted">Picking a plan fills in its limits. Change any number for extra seats, brands or storage.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PLANS.map((p) => {
          const d = PLAN_DEFAULTS[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => pickPlan(p)}
              aria-pressed={plan === p}
              className={`flex flex-col rounded-xl border p-2 text-left transition-colors ${
                plan === p ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong"
              }`}
            >
              <span className="text-xs font-medium">{d.label}</span>
              <span className="text-[11px] text-foreground-muted">{d.priceUsd === null ? "Negotiated" : `$${d.priceUsd}/mo`}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Seats</span>
          <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="None" className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Brands</span>
          <input type="number" min={1} value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="Unlimited" className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Storage (GB)</span>
          <input type="number" min={1} value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="Unlimited" className="field" />
        </label>
      </div>
      <p className="-mt-2 text-xs text-foreground-muted">
        Seats count active members plus pending invites; {UNLIMITED_SEATS} shows as unlimited. Leave brands or storage empty for unlimited.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
          {isPending ? "Saving..." : "Save plan"}
        </button>
        {saved && !error && <span className="text-xs text-foreground-muted">Saved</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </form>
  );
}

function RecordPaymentCard({ agency, today }: { agency: AgencySummary; today: string }) {
  const { isPending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  // A renewal extends from the current paid until date when it's still
  // ahead, so paying early never loses days.
  const base = agency.paid_until && agency.paid_until > today ? agency.paid_until : today;
  const price = PLAN_DEFAULTS[agency.plan].priceUsd;
  const [amount, setAmount] = useState(price ? String(price) : "");
  const [currency, setCurrency] = useState("USD");
  const [paidOn, setPaidOn] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(addMonths(base, 1));
  const [method, setMethod] = useState<PaymentInput["method"]>("cash");
  const [note, setNote] = useState("");

  return (
    <form
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(
          () => recordPayment(agency.org_id, { amount: Number.parseFloat(amount), currency, paidOn, periodEnd, method, note }),
          () => {
            setSaved(true);
            setNote("");
          }
        );
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">Record a payment</h2>
        <p className="mt-1 text-xs text-foreground-muted">Moves the paid until date forward. Generation stops 7 days after it passes.</p>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Amount received</span>
          <input type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Currency</span>
          <input value={currency} maxLength={5} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="field uppercase" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Paid on</span>
          <input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="field" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Covers until</span>
          <input type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="field" />
        </label>
      </div>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {[1, 3, 6, 12].map((m) => (
          <button key={m} type="button" onClick={() => setPeriodEnd(addMonths(base, m))} className="btn-ghost btn-xs">
            +{m} {m === 1 ? "month" : "months"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Method</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentInput["method"])} className="field">
          {(Object.keys(METHOD_LABELS) as PaymentInput["method"][]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. receipt number" className="field" />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
          {isPending ? "Saving..." : "Record payment"}
        </button>
        {saved && !error && <span className="text-xs text-foreground-muted">Recorded</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </form>
  );
}

function PaymentsTable({ orgId, payments }: { orgId: string; payments: Payment[] }) {
  const { isPending, error, run } = useAction();
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold">Payments</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-foreground-muted">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-foreground-muted">
                <th className="py-2 pr-3 font-medium">Paid on</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Covers until</th>
                <th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 pr-3 font-medium">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={`border-b border-border last:border-0 ${p.voided_at ? "text-foreground-muted line-through" : ""}`}>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDay(p.paid_on)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                    {p.currency} {p.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDay(p.period_end)}</td>
                  <td className="py-2 pr-3">{METHOD_LABELS[p.method]}</td>
                  <td className="py-2 pr-3">{p.note ?? ""}</td>
                  <td className="py-2 text-right">
                    {p.voided_at ? (
                      <span className="text-xs no-underline">Voided</span>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (window.confirm("Void this payment? The paid until date goes back to the latest remaining payment.")) {
                            run(() => voidPayment(orgId, p.id));
                          }
                        }}
                        className="btn-ghost btn-xs"
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
