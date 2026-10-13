import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getProduct } from "../../products-data";
import { getAds } from "./ads-data";
import { AdsList } from "./ads-list";
import { BackButton } from "@/app/org/[orgId]/back-button";

export default function AdsPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<AdsSkeleton />}>
        <GatedAds params={params} />
      </Suspense>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-12 animate-pulse rounded-2xl bg-border" />;
}

function AdsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedHeader({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  const { orgId, brandId, productId } = await params;
  await requireOrgMember(orgId);

  const product = await getProduct(orgId, brandId, productId);
  if (!product) notFound();

  return (
    <div>
      <BackButton />
      <Link
        href={`/org/${orgId}/brands/${brandId}/products/${productId}`}
        className="block text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline"
      >
        {product.name}
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Ads</h1>
    </div>
  );
}

async function GatedAds({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  const { orgId, brandId, productId } = await params;
  await requireOrgMember(orgId);

  const product = await getProduct(orgId, brandId, productId);
  if (!product) notFound();

  const ads = await getAds(orgId, productId, { includeArchived: true });

  return <AdsList orgId={orgId} brandId={brandId} productId={productId} ads={ads} />;
}
