import { Suspense } from "react";
import { requireOrgAdmin, isOrgOwner } from "@/lib/auth";
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
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
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
  // Owner and admin see spend; users don't (role matrix, migration 52).
  // Only the owner gets the audit log and the Resume button: both
  // list_org_audit_log() and resume_org() are is_org_owner()-gated.
  await requireOrgAdmin(orgId);
  const canAdminister = await isOrgOwner(orgId);

  const [status, auditLog] = await Promise.all([
    getOrgSpendStatus(orgId),
    canAdminister ? getOrgAuditLog(orgId) : Promise.resolve([]),
  ]);

  return (
    <SpendScreen orgId={orgId} status={status} auditLog={auditLog} canAdminister={canAdminister} />
  );
}
