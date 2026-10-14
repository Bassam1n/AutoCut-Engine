import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { getAccessRequests } from "../data";
import { PageHeader } from "../ui";
import { RequestsPanel } from "./requests-panel";

export default function AccessRequestsPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-2 py-6">
      <PageHeader
        title="Access requests"
        description="People who asked for access on autocutengine.app."
      />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-border" />}>
        <GatedRequests />
      </Suspense>
    </main>
  );
}

async function GatedRequests() {
  await requirePlatformAdmin();
  const requests = await getAccessRequests();
  return <RequestsPanel requests={requests} />;
}
