import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../../brands-data";
import { getProduct, getProductRefs, getProductRefSignedUrls } from "../products-data";
import { ProductForm } from "../product-form";
import { updateProduct, archiveProduct } from "../products-actions";
import { ArchiveProductButton } from "./archive-product-button";
import { RefUploader } from "./ref-uploader";

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-10">
      <Suspense fallback={<HeaderSkeleton />}>
        <GatedHeader params={params} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <GatedDetailForm params={params} />
      </Suspense>

      <div className="border-t border-border pt-8">
        <h2 className="mb-4 text-sm font-semibold">Reference photos</h2>
        <Suspense fallback={<SectionSkeleton />}>
          <GatedRefs params={params} />
        </Suspense>
      </div>
    </main>
  );
}

function HeaderSkeleton() {
  return <div className="h-12 animate-pulse rounded-xl bg-border" />;
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-24 animate-pulse rounded-xl bg-border" />
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

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  const product = await getProduct(orgId, brandId, productId);
  if (!product) notFound();

  return (
    <div>
      <Link
        href={`/org/${orgId}/brands/${brandId}/products`}
        className="text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline"
      >
        {brand.name} / Products
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">
        {product.name}
      </h1>
    </div>
  );
}

async function GatedDetailForm({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  const { orgId, brandId, productId } = await params;
  await requireOrgMember(orgId);

  const product = await getProduct(orgId, brandId, productId);
  if (!product) notFound();

  return (
    <div className="flex flex-col gap-6">
      <ProductForm
        product={product}
        submitLabel="Save changes"
        onSubmit={updateProduct.bind(null, orgId, brandId, productId)}
      />
      <div className="border-t border-border pt-4">
        <ArchiveProductButton
          orgId={orgId}
          brandId={brandId}
          onArchive={archiveProduct.bind(null, orgId, brandId, productId)}
        />
      </div>
    </div>
  );
}

async function GatedRefs({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  const { orgId, brandId, productId } = await params;
  await requireOrgMember(orgId);

  const refs = await getProductRefs(orgId, productId);
  const signedUrls = await getProductRefSignedUrls(orgId, refs);

  return (
    <RefUploader
      orgId={orgId}
      brandId={brandId}
      productId={productId}
      refs={refs}
      signedUrls={signedUrls}
    />
  );
}
