import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import {
  agencyIssues,
  agencyStatus,
  getActivity,
  getAgencies,
  getAgencyBrands,
  getAgencyMembers,
  getAgencyPayments,
  serverNow,
  getDailySpend,
  getSpendBreakdown,
  type AgencySummary,
} from "../../data";
import { PlanBadge, StatTile, StatusBadge, formatDate, formatRelative, formatUsd } from "../../ui";
import { SpendChart } from "../../spend-chart";
import { ActivityList } from "../../activity-list";
import { AgencyQuickActions, AgencySettingsPanel, MembersPanel } from "./agency-panels";
import { BillingPanel } from "./billing-panel";
import { formatSeats } from "@/lib/plans";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "brands", label: "Brands" },
  { id: "billing", label: "Plan & billing" },
  { id: "usage", label: "Usage" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AgencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-2 py-6">
      <Link href="/platform-admin/agencies" className="text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline">
        Agencies
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-border" />}>
        <GatedAgency params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function GatedAgency({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePlatformAdmin();
  const [{ orgId }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "overview";

  const agency = (await getAgencies()).find((a) => a.org_id === orgId);
  if (!agency) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{agency.org_name}</h1>
            <StatusBadge status={agencyStatus(agency)} />
            <PlanBadge plan={agency.plan} />
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            {agency.owner_email ?? "No owner yet"} · Since {formatDate(agency.created_at)}
          </p>
          {agency.suspended_at && (
            <p className="mt-2 text-sm text-danger">
              Suspended {formatRelative(agency.suspended_at)}
              {agency.suspended_reason ? `: ${agency.suspended_reason}` : ""}. Members can&apos;t sign in to this agency.
            </p>
          )}
          {agency.paused && !agency.suspended_at && (
            <p className="mt-2 text-sm text-danger">Paused by spend guard{agency.pause_reason ? `: ${agency.pause_reason}` : ""}.</p>
          )}
        </div>
        <AgencyQuickActions orgId={orgId} suspended={Boolean(agency.suspended_at)} paused={agency.paused} />
      </div>

      <nav aria-label="Agency sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/platform-admin/agencies/${orgId}?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "border-accent text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab agency={agency} />}
      {tab === "members" && <MembersTab agency={agency} />}
      {tab === "brands" && <BrandsTab orgId={orgId} />}
      {tab === "billing" && <BillingTab agency={agency} />}
      {tab === "usage" && <UsageTab orgId={orgId} />}
      {tab === "activity" && <ActivityTab orgId={orgId} limit={150} />}
      {tab === "settings" && <AgencySettingsPanel agency={agency} />}
    </div>
  );
}

async function OverviewTab({ agency }: { agency: AgencySummary }) {
  const [daily, activity] = await Promise.all([getDailySpend(30, agency.org_id), getActivity(agency.org_id, 8)]);
  const issues = agencyIssues(agency);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Seats"
          value={`${agency.members_active} / ${formatSeats(agency.seat_cap)}`}
          hint={agency.pending_invites > 0 ? `${agency.pending_invites} invite${agency.pending_invites === 1 ? "" : "s"} pending` : undefined}
        />
        <StatTile label="Brands" value={`${agency.brands_count} / ${agency.brand_cap ?? "Unlimited"}`} />
        <StatTile label="Ads" value={String(agency.ads_total)} hint={`${agency.ads_30d} in the last 30 days`} />
        <StatTile label="Spend, last 30 days" value={formatUsd(agency.spend_30d)} hint={`${formatUsd(agency.spend_24h)} in the last 24 hours`} />
      </div>

      {issues.length > 0 && !agency.suspended_at && (
        <section className="card flex flex-col gap-2 border-danger/40 p-4">
          <h2 className="text-sm font-semibold text-danger">Needs attention</h2>
          <ul className="list-inside list-disc text-sm">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Daily spend</h2>
        <SpendChart data={daily} height={140} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-sm font-semibold">Internal notes</h2>
          {agency.internal_notes ? (
            <p className="whitespace-pre-wrap text-sm">{agency.internal_notes}</p>
          ) : (
            <p className="text-sm text-foreground-muted">No notes yet. Add some in Settings; only platform admins see them.</p>
          )}
        </section>
        <section className="card flex flex-col p-5">
          <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
          <ActivityList rows={activity} showAgency={false} />
        </section>
      </div>
    </div>
  );
}

async function MembersTab({ agency }: { agency: AgencySummary }) {
  const { members, invites } = await getAgencyMembers(agency.org_id);
  return <MembersPanel agency={agency} members={members} invites={invites} />;
}

async function BrandsTab({ orgId }: { orgId: string }) {
  const brands = await getAgencyBrands(orgId);
  return (
    <div className="card relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-foreground-muted">
            <th className="px-4 py-3 font-medium">Brand</th>
            <th className="px-4 py-3 text-right font-medium">Products</th>
            <th className="px-4 py-3 text-right font-medium">Ads</th>
            <th className="px-4 py-3 text-right font-medium">Assigned users</th>
            <th className="px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {brands.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-foreground-muted">
                This agency hasn&apos;t created any brands yet.
              </td>
            </tr>
          ) : (
            brands.map((b) => (
              <tr key={b.brand_id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-medium">
                  {b.brand_name}
                  {!b.active && <span className="ml-2 text-xs font-normal text-foreground-muted">Archived</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{b.products}</td>
                <td className="px-4 py-3 text-right tabular-nums">{b.ads}</td>
                <td className="px-4 py-3 text-right tabular-nums">{b.assignees}</td>
                <td className="px-4 py-3 text-foreground-muted">{formatDate(b.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

async function UsageTab({ orgId }: { orgId: string }) {
  const [daily, breakdown] = await Promise.all([getDailySpend(90, orgId), getSpendBreakdown(orgId, 90)]);
  const total = breakdown.reduce((n, r) => n + r.usd, 0);
  const byProvider = Array.from(
    breakdown.reduce((m, r) => m.set(r.provider, (m.get(r.provider) ?? 0) + r.usd), new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Daily spend, last 90 days</h2>
          <span className="text-sm font-medium tabular-nums">{formatUsd(total)} total</span>
        </div>
        <SpendChart data={daily} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold">By provider</h2>
          {byProvider.length === 0 ? (
            <p className="text-sm text-foreground-muted">No spend yet.</p>
          ) : (
            byProvider.map(([provider, usd]) => (
              <div key={provider} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 truncate capitalize">{provider}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(usd / byProvider[0][1]) * 100}%`, background: "var(--chart-bar)" }} />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums">{formatUsd(usd)}</span>
              </div>
            ))
          )}
        </section>

        <section className="card relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-foreground-muted">
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Generations</th>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">
                    No spend in the last 90 days.
                  </td>
                </tr>
              ) : (
                breakdown.map((r) => (
                  <tr key={`${r.provider}-${r.kind}`} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 capitalize">{r.provider}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{r.kind.replace(/[:_]/g, " ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.events}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatUsd(r.usd, { precise: true })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

async function ActivityTab({ orgId, limit }: { orgId: string; limit: number }) {
  const rows = await getActivity(orgId, limit);
  return (
    <section className="card p-5">
      <ActivityList rows={rows} showAgency={false} />
    </section>
  );
}

async function BillingTab({ agency }: { agency: AgencySummary }) {
  const payments = await getAgencyPayments(agency.org_id);
  const today = new Date(serverNow()).toISOString().slice(0, 10);
  return <BillingPanel agency={agency} payments={payments} today={today} />;
}
