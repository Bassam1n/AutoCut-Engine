import { Suspense } from "react";
import { requireOrgMember } from "@/lib/auth";
import { ProductForm } from "../product-form";
import { createProduct } from "../products-actions";

export default function NewProductPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Products
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          New product
        </h1>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <GatedForm params={params} />
      </Suspense>
    </main>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

async function GatedForm({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  const { orgId, brandId } = await params;
  await requireOrgMember(orgId);

  return (
    <ProductForm
      submitLabel="Create product"
      onSubmit={createProduct.bind(null, orgId, brandId)}
    />
  );
}
