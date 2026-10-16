// Agency types and pure helpers, kept out of data.ts (server-only) so client components can use them.
import type { BillingState, Plan } from "@/lib/plans";
export { PLANS, PLAN_LABELS, type Plan } from "@/lib/plans";

export type AgencySummary = {
  org_id: string;
  org_name: string;
  plan: Plan;
  created_at: string;
  paused: boolean;
  pause_reason: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  seat_cap: number | null;
  warn_usd: number | null;
  stop_usd: number | null;
  internal_notes: string | null;
  owner_email: string | null;
  owner_accepted: boolean;
  members_active: number;
  members_total: number;
  pending_invites: number;
  brands_count: number;
  ads_total: number;
  ads_30d: number;
  spend_24h: number;
  spend_7d: number;
  spend_30d: number;
  keys_count: number;
  last_activity: string | null;
  brand_cap: number | null;
  storage_quota_gb: number | null;
  storage_bytes: number;
  paid_until: string | null;
  /** Computed server-side from paid_until and today's date. */
  billing_state: BillingState;
};

export type AgencyStatus = "suspended" | "paused" | "invite_pending" | "active";

export function agencyStatus(a: AgencySummary): AgencyStatus {
  if (a.suspended_at) return "suspended";
  if (a.paused) return "paused";
  if (!a.owner_accepted) return "invite_pending";
  return "active";
}

/** Things worth a platform admin's attention, most urgent first. */
export function agencyIssues(a: AgencySummary): string[] {
  const issues: string[] = [];
  if (a.billing_state === "lapsed") issues.push("Subscription lapsed: generation is off");
  else if (a.billing_state === "grace") issues.push("Payment overdue (in the 7 day grace period)");
  else if (a.billing_state === "due_soon") issues.push("Payment due within 7 days");
  if (a.storage_quota_gb !== null && a.storage_bytes >= a.storage_quota_gb * 1e9 * 0.9) {
    issues.push(a.storage_bytes >= a.storage_quota_gb * 1e9 ? "Storage full" : "Storage over 90% full");
  }
  if (a.brand_cap !== null && a.brands_count >= a.brand_cap) issues.push("Brand limit reached");
  if (a.paused) issues.push("Paused by spend guard");
  if (!a.owner_accepted) issues.push("Owner hasn't accepted the invite");
  if (a.seat_cap === null) issues.push("No seat cap set (they can't invite anyone)");
  else if (a.members_active + a.pending_invites >= a.seat_cap) issues.push("Seat limit reached");
  if (a.owner_accepted && a.keys_count === 0) issues.push("No provider keys saved");
  if (a.stop_usd !== null && Number(a.spend_24h) >= Number(a.stop_usd) * 0.8 && !a.paused) {
    issues.push("Near its daily spend stop");
  }
  return issues;
}
