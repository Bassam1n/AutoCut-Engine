import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { getAgencies, serverNow } from "../data";
import { PageHeader } from "../ui";
import { AgenciesTable } from "./agencies-table";

export default function AgenciesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-2 py-6">
      <PageHeader title="Agencies" description="Search, filter and open any agency to manage it." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-border" />}>
        <GatedAgencies searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function GatedAgencies({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requirePlatformAdmin();
  const [{ new: openNew }, agencies] = await Promise.all([searchParams, getAgencies()]);
  return <AgenciesTable agencies={agencies} openNew={openNew === "1"} now={serverNow()} />;
}
