import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../brands-data";
import { getAllBrandCastMembers, getBrandCastAssetUrls } from "./cast-library-data";
import { CastLibraryPanel } from "./cast-library-panel";
import { BackButton } from "../../../back-button";
import { BrandNav } from "../brand-nav";

export default function CastLibraryPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<HeaderSkeleton />}>
        <GatedBrandNav params={params} />
      </Suspense>

      <Suspense fallback={<ListSkeleton />}>
        <GatedPanel params={params} />
      </Suspense>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-12 animate-pulse rounded-2xl bg-border" />;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
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
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Cast library</h1>
      <p className="mt-1 text-sm text-foreground-muted">
        Reusable personas for this brand — create one manually, or save one from an ad&apos;s
        Concept &amp; cast step. Any ad can pick a persona from here instead of generating a new
        character from scratch.
      </p>
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

  return <BrandNav orgId={orgId} brandId={brandId} active="cast" />;
}

async function GatedPanel({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  const members = await getAllBrandCastMembers(orgId, brandId);
  const assetIds = members.flatMap((m) => [m.ref_asset_id, m.sheet_asset_id]).filter((id): id is string => id !== null);
  const assetUrls = await getBrandCastAssetUrls(orgId, assetIds);

  return <CastLibraryPanel orgId={orgId} brandId={brandId} members={members} assetUrls={assetUrls} />;
}
