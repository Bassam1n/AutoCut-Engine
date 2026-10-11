import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { getSidebarInfo } from "./sidebar-data";
import { Sidebar } from "./sidebar";

export default function OrgLayout({
  children,
  params,
}: LayoutProps<"/org/[orgId]">) {
  return (
    <div className="flex min-h-screen">
      <Suspense fallback={<SidebarSkeleton />}>
        <GatedSidebar params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-background-raised">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-border" />
        <div className="h-4 w-24 animate-pulse rounded bg-border" />
      </div>
      <div className="flex flex-col gap-2 px-3">
        <div className="h-8 animate-pulse rounded-lg bg-border" />
        <div className="h-8 animate-pulse rounded-lg bg-border" />
      </div>
    </aside>
  );
}

async function GatedSidebar({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgMember(orgId);

  const info = await getSidebarInfo(orgId);
  if (!info) notFound();

  return <Sidebar orgId={orgId} info={info} />;
}
