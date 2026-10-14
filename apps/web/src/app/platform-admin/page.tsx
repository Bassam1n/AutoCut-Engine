import { Suspense } from "react";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { agencyIssues, agencyStatus, getActivity, getAgencies, getDailySpend } from "./data";
import { PageHeader, StatTile, StatusBadge, formatUsd } from "./ui";
import { SpendChart } from "./spend-chart";
import { ActivityList } from "./activity-list";

export default function PlatformOverviewPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-2 py-6">
      <PageHeader
        title="Overview"
        description="Every agency on AutoCut at a glance."
        actions={
          <Link href="/platform-admin/agencies?new=1" className="btn-primary">
            New agency
          </Link>
        }
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <GatedOverview />
      </Suspense>
    </main>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-border" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedOverview() {
  await requirePlatformAdmin();
  const [agencies, daily, activity] = await Promise.all([getAgencies(), getDailySpend(30), getActivity(null, 12)]);

  const live = agencies.filter((a) => !a.suspended_at);
  const seats = live.reduce((n, a) => n + a.members_active, 0);
  const spend30 = agencies.reduce((n, a) => n + a.spend_30d, 0);
  const spend7 = agencies.reduce((n, a) => n + a.spend_7d, 0);
  const ads30 = agencies.reduce((n, a) => n + a.ads_30d, 0);
  const attention = agencies
    .map((a) => ({ agency: a, issues: agencyIssues(a) }))
    .filter((x) => x.issues.length > 0 && !x.agency.suspended_at);
  const topSpenders = [...agencies].filter((a) => a.spend_30d > 0).sort((a, b) => b.spend_30d - a.spend_30d).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Agencies"
          value={String(live.length)}
          hint={agencies.length > live.length ? `${agencies.length - live.length} suspended` : "All active"}
        />
        <StatTile label="Active seats" value={String(seats)} hint="Across active agencies" />
        <StatTile label="Spend, last 30 days" value={formatUsd(spend30)} hint={`${formatUsd(spend7)} in the last 7 days`} />
        <StatTile label="Ads created, last 30 days" value={String(ads30)} />
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Daily spend, all agencies</h2>
          <span className="text-xs text-foreground-muted">Last 30 days, provider cost estimates</span>
        </div>
        <SpendChart data={daily} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="card flex flex-col p-5">
          <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="text-sm text-foreground-muted">Nothing needs attention right now.</p>
          ) : (
            <ul className="flex flex-col">
              {attention.map(({ agency, issues }) => (
                <li key={agency.org_id} className="border-t border-border first:border-t-0">
                  <Link
                    href={`/platform-admin/agencies/${agency.org_id}`}
                    className="-mx-2 flex items-start justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-border/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{agency.org_name}</span>
                      <span className="block text-xs text-foreground-muted">{issues.join(" · ")}</span>
                    </span>
                    <StatusBadge status={agencyStatus(agency)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex flex-col p-5">
          <h2 className="mb-3 text-sm font-semibold">Top spenders, last 30 days</h2>
          {topSpenders.length === 0 ? (
            <p className="text-sm text-foreground-muted">No spend in the last 30 days.</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {topSpenders.map((a) => (
                <li key={a.org_id} className="flex items-center gap-3 text-sm">
                  <Link href={`/platform-admin/agencies/${a.org_id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {a.org_name}
                  </Link>
                  <span className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-border">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(a.spend_30d / topSpenders[0].spend_30d) * 100}%`, background: "var(--chart-bar)" }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums">{formatUsd(a.spend_30d)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card flex flex-col p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <Link href="/platform-admin/activity" className="text-xs font-medium text-accent hover:underline">
            See all
          </Link>
        </div>
        <ActivityList rows={activity} showAgency />
      </section>
    </div>
  );
}
