import { Suspense } from "react";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getAllOrgAds } from "../brands/[brandId]/products/[productId]/ads/ads-data";

export default function CreativeHistoryPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Creative history
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Every ad across your org
        </h1>
      </div>

      <Suspense fallback={<Skeleton />}>
        <GatedHistory params={params} />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
      <div className="h-16 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedHistory({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgMember(orgId);

  const ads = await getAllOrgAds(orgId);

  if (ads.length === 0) {
    return <p className="text-sm text-foreground-muted">No ads created yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {ads.map((ad) => {
        const displayName = ad.name || ad.brief.hooks?.[0] || ad.brief.idea || "Untitled ad";
        return (
          <Link
            key={ad.id}
            href={`/org/${orgId}/brands/${ad.brand_id}/products/${ad.product_id}/ads/${ad.id}`}
            className="card card-interactive flex items-center justify-between p-4"
          >
            <div>
              <p className="font-medium">{displayName}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">
                {ad.brand_name} — {ad.product_name} — {new Date(ad.created_at).toLocaleDateString()}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium capitalize text-accent">
              {ad.status}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
