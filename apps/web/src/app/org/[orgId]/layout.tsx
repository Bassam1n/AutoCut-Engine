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
    <div className="flex min-h-screen gap-4 p-4">
      <Suspense fallback={<SidebarSkeleton />}>
        <GatedSidebar params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="sticky top-4 flex h-[calc(100vh-2rem)] w-64 shrink-0 flex-col self-start rounded-3xl bg-background-raised px-3 py-5 shadow-[var(--shadow-raised)]">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="h-8 w-8 animate-pulse rounded-full bg-border" />
        <div className="h-4 w-24 animate-pulse rounded-full bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-9 animate-pulse rounded-full bg-border" />
        <div className="h-9 animate-pulse rounded-full bg-border" />
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
