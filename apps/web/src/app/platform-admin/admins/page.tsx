import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { getPlatformAdmins } from "../data";
import { PageHeader } from "../ui";
import { AdminsPanel } from "./admins-panel";

export default function PlatformAdminsPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-2 py-6">
      <PageHeader title="Platform admins" description="People who can see and manage every agency." />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-border" />}>
        <GatedAdmins />
      </Suspense>
    </main>
  );
}

async function GatedAdmins() {
  const user = await requirePlatformAdmin();
  const admins = await getPlatformAdmins();
  return <AdminsPanel admins={admins} currentUserId={user.id} />;
}
