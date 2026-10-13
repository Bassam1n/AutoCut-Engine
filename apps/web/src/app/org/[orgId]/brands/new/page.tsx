import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { BrandForm } from "../brand-form";
import { createBrand } from "../brands-actions";
import { BackButton } from "../../back-button";
import { getAssignableUsers } from "../assignment-data";

export default function NewBrandPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-10">
      <div>
        <BackButton />
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Brands
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          New brand
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
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgAdmin(orgId);
  const users = await getAssignableUsers(orgId);

  return (
    <BrandForm
      submitLabel="Create brand"
      onSubmit={createBrand.bind(null, orgId)}
      assignees={{ users, selectedIds: [] }}
    />
  );
}
