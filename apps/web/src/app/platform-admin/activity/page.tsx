import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { getActivity, getAgencies } from "../data";
import { PageHeader } from "../ui";
import { ActivityList } from "../activity-list";
import { AgencyFilter } from "./agency-filter";

export default function ActivityPage({ searchParams }: { searchParams: Promise<{ agency?: string }> }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-2 py-6">
      <PageHeader title="Activity" description="Everything that changed across agencies, newest first." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-border" />}>
        <GatedActivity searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function GatedActivity({ searchParams }: { searchParams: Promise<{ agency?: string }> }) {
  await requirePlatformAdmin();
  const { agency } = await searchParams;
  const agencies = await getAgencies();
  const selected = agencies.some((a) => a.org_id === agency) ? agency! : null;
  const rows = await getActivity(selected, 300);

  return (
    <div className="flex flex-col gap-4">
      <AgencyFilter
        agencies={agencies.map((a) => ({ id: a.org_id, name: a.org_name }))}
        selected={selected}
      />
      <section className="card p-5">
        <ActivityList rows={rows} showAgency={!selected} />
      </section>
    </div>
  );
}
