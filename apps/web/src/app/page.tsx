import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      {/* Static shell: no session read here, prerenders instantly. */}
      <div className="mb-10 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-ink">
          AC
        </div>
        <span className="text-base font-semibold tracking-tight">
          AutoCut Engine
        </span>
      </div>

      {/* Reads the session, so this streams in behind the boundary —
          per ADR 001, never at the layout/page top level. */}
      <Suspense fallback={<AccountBadgeSkeleton />}>
        <AccountBadge />
      </Suspense>
    </main>
  );
}

function AccountBadgeSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background-raised p-4">
      <div className="h-4 w-40 animate-pulse rounded bg-border" />
      <div className="h-8 w-20 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

async function AccountBadge() {
  const user = await getCurrentUser();
  const adminOrgId = await getFirstAdminOrgId();

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background-raised p-4">
      <p className="text-sm">
        Signed in as{" "}
        <span className="font-medium">{user.email}</span>
      </p>
      <div className="flex items-center gap-2">
        {adminOrgId && (
          <Link
            href={`/org/${adminOrgId}/team`}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border/40"
          >
            Manage team
          </Link>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border/40"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

async function getFirstAdminOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;

  const { data } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.user.id)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  return data?.org_id ?? null;
}
