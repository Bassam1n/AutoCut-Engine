import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { RegisterAgencyForm } from "./register-agency-form";

export default function PlatformAdminPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-10">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Platform admin
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Register a new agency
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          This creates the org and the owner&apos;s account. Joining an
          existing agency after this is invite-only, managed by that
          agency&apos;s own admins.
        </p>
      </div>

      {/* Gate check happens inside; this suspends on the session read. */}
      <Suspense fallback={<FormSkeleton />}>
        <GatedForm />
      </Suspense>
    </main>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 animate-pulse rounded-lg bg-border" />
      <div className="h-10 w-32 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

async function GatedForm() {
  await requirePlatformAdmin();
  return (
    <div className="rounded-xl border border-border bg-background-raised p-6 shadow-sm">
      <RegisterAgencyForm />
    </div>
  );
}
