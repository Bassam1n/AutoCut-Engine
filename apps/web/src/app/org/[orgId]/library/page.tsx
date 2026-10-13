import { Suspense } from "react";
import { requireOrgMember } from "@/lib/auth";
import { getBrands } from "../brands/brands-data";
import { getLibraryItems, getLibrarySignedUrls, getAllOrgCastMembers } from "./library-data";
import { LibraryBrowser } from "./library-browser";

/**
 * Org-wide Library page (spec §5.9). Follows the same Suspense +
 * gated-async-component shape as products/page.tsx and
 * creative-history/page.tsx — one top-level gate that calls
 * requireOrgMember before touching any org-scoped data.
 */
export default function LibraryPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Library
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Saved images and videos
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Search, filter, rename, favourite and assign a brand. Drag an
          image into a scene from Scene images, or set one as a character
          or style reference below.
        </p>
      </div>

      <Suspense fallback={<Skeleton />}>
        <GatedLibrary params={params} />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="aspect-square animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}

async function GatedLibrary({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgMember(orgId);

  const [items, brands, castMembers] = await Promise.all([
    getLibraryItems(orgId),
    getBrands(orgId),
    getAllOrgCastMembers(orgId),
  ]);
  const urls = await getLibrarySignedUrls(items.map((item) => item.asset_storage_path));

  return <LibraryBrowser orgId={orgId} items={items} brands={brands} castMembers={castMembers} urls={urls} />;
}
