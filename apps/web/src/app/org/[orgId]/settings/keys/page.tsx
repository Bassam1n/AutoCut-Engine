import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { getOrgSecrets } from "./keys-data";
import { KeysScreen } from "./keys-screen";

export default function KeysPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Settings
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Provider keys
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Keys are write-only — only the last 4 characters are ever shown
          again, and every key is tested before it&apos;s saved.
        </p>
      </div>

      <Suspense fallback={<KeysSkeleton />}>
        <GatedKeysScreen params={params} />
      </Suspense>
    </main>
  );
}

function KeysSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedKeysScreen({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgAdmin(orgId);

  const secrets = await getOrgSecrets(orgId);

  return <KeysScreen orgId={orgId} secrets={secrets} />;
}
