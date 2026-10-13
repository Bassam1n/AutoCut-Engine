import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { getMyMembership } from "@/lib/membership";
import { TeamScreen } from "./team-screen";
import { getOrgMembers, getOrgPendingInvites, getOrgSeatInfo } from "./team-data";

export default function OrgTeamPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Team
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Your team
        </h1>
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
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
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

  const [members, invites, seatInfo, me] = await Promise.all([
    getOrgMembers(orgId),
    getOrgPendingInvites(orgId),
    getOrgSeatInfo(orgId),
    getMyMembership(orgId),
  ]);

  return (
    <TeamScreen
      orgId={orgId}
      members={members}
      invites={invites}
      seatInfo={seatInfo}
      viewerId={me?.userId ?? ""}
      canManage={me?.role === "owner"}
    />
  );
}
