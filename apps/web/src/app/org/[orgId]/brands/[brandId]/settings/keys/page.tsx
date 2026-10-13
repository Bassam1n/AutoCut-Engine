import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgAdmin, requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../../brands-data";
import { getBrandSecrets } from "./keys-data";
import { KeysScreen } from "./keys-screen";
import { BrandNav } from "../../brand-nav";
import { BackButton } from "../../../../back-button";

export default function BrandKeysPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<HeaderSkeleton />}>
        <GatedBrandNav params={params} />
      </Suspense>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Brand settings
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Provider keys
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Keys are write-only — only the last 4 characters are ever shown
          again, and every key is tested before it&apos;s saved. If this brand
          has no key saved for a provider, generation falls back to the
          org-wide key automatically.
        </p>
      </div>

      <Suspense fallback={<KeysSkeleton />}>
        <GatedKeysScreen params={params} />
      </Suspense>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-12 animate-pulse rounded-2xl bg-border" />;
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

async function GatedHeader({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  return (
    <div>
      <BackButton />
      <Link
        href={`/org/${orgId}/brands/${brandId}/customers`}
        className="block text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline"
      >
        {brand.name}
      </Link>
    </div>
  );
}

async function GatedBrandNav({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  return <BrandNav orgId={orgId} brandId={brandId} active="settings" />;
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
