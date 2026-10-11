import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { RegisterAgencyForm } from "./register-agency-form";
import { MembershipTable } from "./membership-table";
import { getAllOrgsWithMembers, getAllPendingInvites } from "./membership-data";

export default function PlatformAdminPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div>
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Platform admin
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Register a new agency
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted">
            This creates the org and the owner&apos;s account. Joining an
            existing agency after this is invite-only, managed by that
            agency&apos;s own admins.
          </p>
        </div>

        {/* Gate check happens inside; this suspends on the session read. */}
        <Suspense fallback={<FormSkeleton />}>
          <GatedForm />
        </Suspense>
      </div>

      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Owners &amp; team members
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Manage seat access and roles across every agency.
          </p>
        </div>

        <Suspense fallback={<TableSkeleton />}>
          <GatedMembershipTable />
        </Suspense>
      </div>
    </main>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 w-32 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-xl bg-border" />
      <div className="h-24 animate-pulse rounded-xl bg-border" />
    </div>
  );
}

async function GatedForm() {
  await requirePlatformAdmin();
  return (
    <div className="rounded-xl border border-border bg-background-raised p-6 shadow-sm">
      <RegisterAgencyForm />
    </div>
  );
}

async function GatedMembershipTable() {
  await requirePlatformAdmin();
  const [members, invites] = await Promise.all([
    getAllOrgsWithMembers(),
    getAllPendingInvites(),
  ]);
  return <MembershipTable members={members} invites={invites} />;
}
