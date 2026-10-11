import { Suspense } from "react";
import { requireOrgAdmin, getCurrentUser } from "@/lib/auth";
import { signOut } from "@/app/actions";
import { TeamScreen } from "./team-screen";
import { getOrgMembers, getOrgPendingInvites, getOrgSeatInfo } from "./team-data";

export default function OrgTeamPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Team
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Manage your team
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted">
            Invite teammates, change their role, or deactivate a seat.
          </p>
        </div>

        <Suspense fallback={<SignOutSkeleton />}>
          <AccountMenu />
        </Suspense>
      </div>

      <Suspense fallback={<TeamSkeleton />}>
        <GatedTeamScreen params={params} />
      </Suspense>
    </main>
  );
}

function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-10 animate-pulse rounded-lg bg-border" />
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

async function GatedTeamScreen({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgAdmin(orgId);

  const [members, invites, seatInfo] = await Promise.all([
    getOrgMembers(orgId),
    getOrgPendingInvites(orgId),
    getOrgSeatInfo(orgId),
  ]);

  return (
    <TeamScreen orgId={orgId} members={members} invites={invites} seatInfo={seatInfo} />
  );
}
