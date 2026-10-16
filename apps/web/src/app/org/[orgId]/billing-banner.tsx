import Link from "next/link";
import { isOrgAdmin } from "@/lib/auth";
import { serverToday } from "@/lib/server-today";
import { GRACE_DAYS, addDays, billingState } from "@/lib/plans";
import { getOrgPaidUntil } from "./settings/plan/plan-data";

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Renewal reminder. Owners and admins see it from 7 days before the
 * paid until date; once generation has stopped, every member sees why.
 */
export async function BillingBanner({ orgId }: { orgId: string }) {
  const paidUntil = await getOrgPaidUntil(orgId);
  if (!paidUntil) return null;
  const state = billingState(paidUntil, serverToday());
  if (state === "active" || state === "not_enforced") return null;

  const admin = await isOrgAdmin(orgId);
  if (!admin && state !== "lapsed") return null;

  const message =
    state === "due_soon"
      ? `Your AutoCut plan renews on ${formatDay(paidUntil)}. Arrange payment with AutoCut to keep generating.`
      : state === "grace"
        ? `Your AutoCut payment was due on ${formatDay(paidUntil)}. Generation stops on ${formatDay(addDays(paidUntil, GRACE_DAYS + 1))}.`
        : admin
          ? "Your AutoCut plan has ended, so generation is off. Everything you've made is still here; renew with AutoCut to continue."
          : "Generation is paused for this agency. Your agency owner can renew the AutoCut plan.";

  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm ${
        state === "due_soon" ? "bg-accent-soft text-foreground" : "bg-danger-soft text-danger"
      }`}
    >
      <span>{message}</span>
      {admin && (
        <Link href={`/org/${orgId}/settings/plan`} className="font-medium underline">
          Plan &amp; usage
        </Link>
      )}
    </div>
  );
}
