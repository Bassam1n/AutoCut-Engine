import { Suspense } from "react";
import Link from "next/link";
import { requireOrgMember, canManageBrandContent } from "@/lib/auth";
import { getBrands } from "../brands/brands-data";
import { getAllOrgProducts } from "../brands/[brandId]/products/products-data";
import { PRODUCT_CATEGORY_LABELS } from "../brands/[brandId]/products/product-categories";
import { AddProductButton } from "./add-product-button";

export default function OrgProductsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Products
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            All products
          </h1>
        </div>
        <Suspense fallback={null}>
          <GatedAddButton params={params} />
        </Suspense>
      </div>

      <Suspense fallback={<Skeleton />}>
        <GatedProducts params={params} />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
      <div className="h-24 animate-pulse rounded-2xl bg-border" />
    </div>
  );
}

async function GatedAddButton({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgMember(orgId);
  if (!(await canManageBrandContent(orgId))) return null;
  return <AddProductButton orgId={orgId} />;
}

async function GatedProducts({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgMember(orgId);

  const [brands, products] = await Promise.all([getBrands(orgId), getAllOrgProducts(orgId)]);

  if (brands.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No brands yet — create one before adding products.
      </p>
    );
  }

  const productsByBrand = new Map<string, typeof products>();
  for (const product of products) {
    const list = productsByBrand.get(product.brand_id) ?? [];
    list.push(product);
    productsByBrand.set(product.brand_id, list);
  }

  return (
    <div className="flex flex-col gap-8">
      {brands.map((brand) => {
        const brandProducts = productsByBrand.get(brand.id) ?? [];
        return (
          <div key={brand.id} className="flex flex-col gap-3">
            <Link
              href={`/org/${orgId}/brands/${brand.id}/products`}
              className="text-sm font-semibold tracking-tight hover:underline"
            >
              {brand.name}
            </Link>
            {brandProducts.length === 0 ? (
              <p className="text-sm text-foreground-muted">No products yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {brandProducts.map((product) => (
                  <Link
                    key={product.id}
                    href={`/org/${orgId}/brands/${brand.id}/products/${product.id}`}
                    className="card card-interactive flex items-center justify-between p-4"
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      {product.what_it_is && (
                        <p className="mt-0.5 text-sm text-foreground-muted">{product.what_it_is}</p>
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
      })}
    </div>
  );
}
