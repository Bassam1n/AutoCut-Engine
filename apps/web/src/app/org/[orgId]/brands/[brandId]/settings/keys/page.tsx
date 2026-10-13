import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { getBrandSecrets } from "./keys-data";
import { KeysScreen } from "./keys-screen";

export default function BrandKeysPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Brand settings
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
      <div className="h-16 animate-pulse rounded-xl bg-border" />
      <div className="h-16 animate-pulse rounded-xl bg-border" />
      <div className="h-16 animate-pulse rounded-xl bg-border" />
    </div>
  );
}

async function GatedKeysScreen({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgAdmin(orgId);

  const secrets = await getBrandSecrets(orgId, brandId);

  return <KeysScreen orgId={orgId} brandId={brandId} secrets={secrets} />;
}
