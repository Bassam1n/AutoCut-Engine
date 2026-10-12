import { Suspense } from "react";
import { requireOrgMember, isOrgAdmin } from "@/lib/auth";
import { getOrgSpendStatus, getOrgAuditLog } from "./spend-data";
import { SpendScreen } from "./spend-screen";

export default function SpendPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Settings
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Spend &amp; spend guard
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Rolling 24 hour spend against your warn and stop thresholds, and the
          org&apos;s audit trail.
        </p>
      </div>

      <Suspense fallback={<SpendSkeleton />}>
        <GatedSpendScreen params={params} />
      </Suspense>
    </main>
  );
}

function SpendSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-xl bg-border" />
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

async function GatedSpendScreen({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  // Visible to every member — orgs_select_own (migration 4) already
  // lets any member read warn_usd/stop_usd/paused/pause_reason
  // directly, matching spend_guard.sql's own stated intent ("editors
  // see spend, that's the whole point of the spend admin screen").
  // Only the audit log and the Resume button are admin-only (audit_log
  // itself is admin-gated at the RLS level via audit_log_select_admin)
  // — isOrgAdmin() below decides whether to fetch/show those, it does
  // NOT gate the page itself.
  await requireOrgMember(orgId);
  const canAdminister = await isOrgAdmin(orgId);

  const [status, auditLog] = await Promise.all([
    getOrgSpendStatus(orgId),
    canAdminister ? getOrgAuditLog(orgId) : Promise.resolve([]),
  ]);

  return (
    <SpendScreen orgId={orgId} status={status} auditLog={auditLog} canAdminister={canAdminister} />
  );
}
