import { Suspense } from "react";
import Link from "next/link";
import { requirePlatformAdmin, getCurrentUser } from "@/lib/auth";
import { signOut } from "../actions";
import { RegisterAgencyForm } from "./register-agency-form";
import { MembershipTable } from "./membership-table";
import { getAllOrgsWithMembers, getAllPendingInvites } from "./membership-data";

export default function PlatformAdminPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
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

        <div className="flex shrink-0 items-start gap-3">
          <Link
            href="/platform-admin/prompts"
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border/40"
          >
            Agent prompts
          </Link>
          <Suspense fallback={<SignOutSkeleton />}>
            <AccountMenu />
          </Suspense>
        </div>
      </div>

      <div>
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

function SignOutSkeleton() {
  return <div className="h-9 w-20 shrink-0 animate-pulse rounded-lg bg-border" />;
}

async function AccountMenu() {
  const user = await getCurrentUser();
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <p className="text-xs text-foreground-muted">{user.email}</p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border/40"
        >
          Sign out
        </button>
      </form>
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
