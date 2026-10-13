import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../brands-data";
import { getProducts } from "./products-data";
import { PRODUCT_CATEGORY_LABELS } from "./product-categories";
import { BackButton } from "../../../back-button";
import { BrandNav } from "../brand-nav";
import { buttonVariants } from "@/components/button";

export default function ProductsPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<ProductsSkeleton />}>
        <GatedBrandNav params={params} />
      </Suspense>

      <Suspense fallback={<ProductsSkeleton />}>
        <GatedProducts params={params} />
      </Suspense>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-12 animate-pulse rounded-2xl bg-border" />;
}

function ProductsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-20 animate-pulse rounded-2xl bg-border" />
      <div className="h-20 animate-pulse rounded-2xl bg-border" />
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
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Products</h1>
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

  return <BrandNav orgId={orgId} brandId={brandId} active="products" />;
}

async function GatedProducts({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  const products = await getProducts(orgId, brandId);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/org/${orgId}/brands/${brandId}/products/new`}
        className={`self-start ${buttonVariants.primary}`}
      >
        New product
      </Link>

      {products.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No products yet for this brand.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/org/${orgId}/brands/${brandId}/products/${product.id}`}
              className="card card-interactive flex items-center justify-between p-4"
            >
              <div>
                <p className="font-medium">{product.name}</p>
                {product.what_it_is && (
                  <p className="mt-0.5 text-sm text-foreground-muted">
                    {product.what_it_is}
                  </p>
                )}
              </div>
              {product.category && (
                <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {PRODUCT_CATEGORY_LABELS[product.category]}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
