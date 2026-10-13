import { Suspense } from "react";
import { requireOrgMember, isOrgAdmin } from "@/lib/auth";
import { getOrgRules, getScopeNameLookup } from "./rules-data";
import { RulesScreen } from "./rules-screen";

export default function RulesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Settings
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Rules</h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          DO/AVOID rules distilled from remembered feedback, injected into later prompt writing.
          Every member can see why generations look the way they do; only an admin can edit,
          pause or delete a rule.
        </p>
      </div>

      <Suspense fallback={<RulesSkeleton />}>
        <GatedRulesScreen params={params} />
      </Suspense>
    </main>
  );
}

function RulesSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedRulesScreen({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  // Visible to every member — rules_select (migration 10) has no
  // admin restriction, same split as settings/spend: requireOrgMember
  // gates the page, isOrgAdmin() decides whether edit/pause/delete
  // controls render within it.
  await requireOrgMember(orgId);
  const canAdminister = await isOrgAdmin(orgId);

  const rules = await getOrgRules(orgId);
  const scopeNames = await getScopeNameLookup(orgId, rules);

  return (
    <RulesScreen orgId={orgId} rules={rules} scopeNames={scopeNames} canAdminister={canAdminister} />
  );
}
