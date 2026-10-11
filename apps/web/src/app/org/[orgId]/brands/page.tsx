import { Suspense } from "react";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getBrands } from "./brands-data";
import { getSetupChecklist } from "../setup-checklist/checklist-data";
import { ChecklistCard } from "../setup-checklist/checklist-card";

export default function BrandsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Brands
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Your brands
          </h1>
        </div>
      </div>

      <Suspense fallback={null}>
        <GatedChecklist params={params} />
      </Suspense>

      <Suspense fallback={<BrandsSkeleton />}>
        <GatedBrandsList params={params} />
      </Suspense>
    </main>
  );
}

async function GatedChecklist({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgMember(orgId);

  const checklist = await getSetupChecklist(orgId);

  return <ChecklistCard orgId={orgId} checklist={checklist} />;
}

function BrandsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-20 animate-pulse rounded-xl bg-border" />
      <div className="h-20 animate-pulse rounded-xl bg-border" />
    </div>
  );
}

async function GatedBrandsList({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgMember(orgId);
  const brands = await getBrands(orgId);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/org/${orgId}/brands/new`}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        New brand
      </Link>

      {brands.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No brands yet. Create your first one to start building products
          and ads.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/org/${orgId}/brands/${brand.id}/customers`}
              className="flex items-center gap-3 rounded-xl border border-border bg-background-raised p-4 transition-colors hover:border-border-strong"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                {brand.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logo_url}
                    alt={brand.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  brand.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <span className="font-medium">{brand.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
