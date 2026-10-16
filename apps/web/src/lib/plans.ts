/**
 * Plan catalogue. Payments are taken in person and recorded by a
 * platform admin, so this only describes each plan's default limits;
 * the effective limits live on the org (seat_cap, brand_cap,
 * storage_quota_gb) and can be overridden per agency. No "server-only"
 * guard: client components show these too.
 */
export type Plan = "trial" | "starter" | "agency" | "studio" | "custom";

export const PLANS: Plan[] = ["trial", "starter", "agency", "studio", "custom"];

export type PlanDefaults = {
  label: string;
  /** Monthly price in USD, for display; null when negotiated. */
  priceUsd: number | null;
  seats: number;
  /** null = unlimited */
  brands: number | null;
  storageGb: number;
  whiteLabel: boolean;
};

/** A seat cap at or above this shows as "Unlimited". */
export const UNLIMITED_SEATS = 999;

export const PLAN_DEFAULTS: Record<Plan, PlanDefaults> = {
  trial: { label: "Trial", priceUsd: 0, seats: 3, brands: 3, storageGb: 5, whiteLabel: false },
  starter: { label: "Starter", priceUsd: 97, seats: 3, brands: 3, storageGb: 25, whiteLabel: false },
  agency: { label: "Agency", priceUsd: 297, seats: 10, brands: null, storageGb: 250, whiteLabel: false },
  studio: { label: "Studio", priceUsd: 497, seats: UNLIMITED_SEATS, brands: null, storageGb: 1000, whiteLabel: true },
  custom: { label: "Custom", priceUsd: null, seats: 10, brands: null, storageGb: 250, whiteLabel: false },
};

export const PLAN_LABELS: Record<Plan, string> = Object.fromEntries(
  PLANS.map((p) => [p, PLAN_DEFAULTS[p].label])
) as Record<Plan, string>;

/** Days after paid_until before generation stops. Matches claim_paid_job. */
export const GRACE_DAYS = 7;

export type BillingState = "not_enforced" | "active" | "due_soon" | "grace" | "lapsed";

/** today: YYYY-MM-DD. paidUntil: YYYY-MM-DD or null. */
export function billingState(paidUntil: string | null, today: string): BillingState {
  if (!paidUntil) return "not_enforced";
  const days = daysBetween(today, paidUntil);
  if (days >= 7) return "active";
  if (days >= 0) return "due_soon";
  if (days >= -GRACE_DAYS) return "grace";
  return "lapsed";
}

/** Whole days from a to b (both YYYY-MM-DD); negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e8 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(bytes < 1e10 ? 2 : 1)} GB`;
}

export function formatSeats(cap: number | null): string {
  if (cap === null) return "none";
  return cap >= UNLIMITED_SEATS ? "Unlimited" : String(cap);
}
