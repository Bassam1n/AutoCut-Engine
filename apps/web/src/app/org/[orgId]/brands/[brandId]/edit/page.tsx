import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { getBrand } from "../../brands-data";
import { BrandForm } from "../../brand-form";
import { updateBrand, archiveBrand } from "../../brands-actions";
import { ArchiveBrandButton } from "./archive-brand-button";

export default function EditBrandPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Brands
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Edit brand
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
      <div className="h-24 animate-pulse rounded-lg bg-border" />
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

  const brand = await getBrand(orgId, brandId);
  if (!brand) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BrandForm
        brand={brand}
        submitLabel="Save changes"
        onSubmit={(formData) => updateBrand(orgId, brandId, formData)}
      />

      <div className="border-t border-border pt-4">
        <ArchiveBrandButton
          onArchive={() => archiveBrand(orgId, brandId)}
          orgId={orgId}
        />
      </div>
    </div>
  );
}
