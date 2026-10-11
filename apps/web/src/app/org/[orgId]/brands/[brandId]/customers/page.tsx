import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../brands-data";
import { getCustomers } from "./customers-data";
import { CustomerScreen } from "./customer-screen";
import { BackButton } from "../../../back-button";

export default function BrandCustomersPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<CustomersSkeleton />}>
        <GatedBrandNav params={params} />
      </Suspense>

      <Suspense fallback={<CustomersSkeleton />}>
        <GatedCustomers params={params} />
      </Suspense>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-16 animate-pulse rounded-xl bg-border" />;
}

function CustomersSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-xl bg-border" />
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <BackButton />
        <Link
          href={`/org/${orgId}/brands`}
          className="block text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline"
        >
          Brands
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {brand.name}
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Audience profiles for this brand.
        </p>
      </div>
      <Link
        href={`/org/${orgId}/brands/${brandId}/edit`}
        className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border/40"
      >
        Edit brand
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

  return (
    <div className="flex gap-2 border-b border-border pb-3">
      <span className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent">
        Customers
      </span>
      <Link
        href={`/org/${orgId}/brands/${brandId}/products`}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-border/40"
      >
        Products
      </Link>
    </div>
  );
}

async function GatedCustomers({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  const customers = await getCustomers(orgId, brandId);

  return <CustomerScreen orgId={orgId} brandId={brandId} customers={customers} />;
}
