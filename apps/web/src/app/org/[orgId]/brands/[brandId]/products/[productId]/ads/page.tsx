import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getProduct } from "../../products-data";
import { getAds } from "./ads-data";
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
  return <div className="h-12 animate-pulse rounded-xl bg-border" />;
}

function AdsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-xl bg-border" />
      <div className="h-16 animate-pulse rounded-xl bg-border" />
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

  const ads = await getAds(orgId, productId);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/org/${orgId}/brands/${brandId}/products/${productId}/ads/new`}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        New ad
      </Link>

      {ads.length === 0 ? (
        <p className="text-sm text-foreground-muted">No ads yet for this product.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {ads.map((ad) => (
            <Link
              key={ad.id}
              href={`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-background-raised p-4 transition-colors hover:border-border-strong"
            >
              <div>
                <p className="font-medium">
                  {ad.brief.hooks?.[0] || ad.brief.idea || "Untitled ad"}
                </p>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  {new Date(ad.created_at).toLocaleDateString()}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium capitalize text-accent">
                {ad.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
