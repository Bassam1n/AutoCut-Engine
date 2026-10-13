import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireCanCreateAds } from "@/lib/auth";
import { getProduct } from "../../../products-data";
import { getVisibleStyles } from "@/app/org/[orgId]/styles/styles-data";
import { NewAdForm } from "./new-ad-form";
import { BackButton } from "@/app/org/[orgId]/back-button";

export default function NewAdPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <div>
        <BackButton />
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          New ad
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Pick a style to start
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          The style sets the look and the default image/video models for
          this ad. You can change it later.
        </p>
      </div>

      <Suspense fallback={<PickerSkeleton />}>
        <GatedPicker params={params} />
      </Suspense>
    </main>
  );
}

function PickerSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}

async function GatedPicker({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string }>;
}) {
  const { orgId, brandId, productId } = await params;
  await requireCanCreateAds(orgId);

  const product = await getProduct(orgId, brandId, productId);
  if (!product) notFound();

  const styles = await getVisibleStyles(orgId);

  return <NewAdForm orgId={orgId} brandId={brandId} productId={productId} styles={styles} />;
}
