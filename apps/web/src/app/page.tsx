import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      {/* Static shell: no session read here, prerenders instantly. */}
      <div className="mb-10 flex items-center gap-2.5">
        <Image src="/logo-mark.png" alt="" width={360} height={144} priority className="h-8 w-auto" />
        <span className="text-base font-semibold tracking-tight">
          AutoCut Engine
        </span>
      </div>

      {/* Reads the session, so this streams in behind the boundary —
          per ADR 001, never at the layout/page top level. Redirects
          into the org sidebar shell when the user belongs to one;
          this screen is only ever seen by someone signed in but not
          (yet) a member of any org, e.g. a platform admin. */}
      <Suspense fallback={<AccountBadgeSkeleton />}>
        <AccountBadge />
      </Suspense>
    </main>
  );
}

function AccountBadgeSkeleton() {
  return (
    <div className="card flex items-center justify-between p-4">
      <div className="h-4 w-40 animate-pulse rounded bg-border" />
      <div className="h-8 w-20 animate-pulse rounded-lg bg-border" />
    </div>
  );
}

async function AccountBadge() {
  const user = await getCurrentUser();
  const orgId = await getFirstOrgId();

  if (orgId) {
    redirect(`/org/${orgId}/brands`);
  }

  const supabase = await createClient();
  const [{ data: isPlatformAdmin }, { data: suspended }] = await Promise.all([
    supabase.rpc("is_platform_admin"),
    supabase.rpc("my_suspended_orgs"),
  ]);
  if (isPlatformAdmin) {
    redirect("/platform-admin");
  }

  return (
    <div className="flex flex-col gap-4">
      {(suspended ?? []).map((org: { org_id: string; org_name: string }) => (
        <div key={org.org_id} className="card border-danger/40 p-4">
          <p className="text-sm font-medium">{org.org_name} is suspended</p>
          <p className="mt-1 text-sm text-foreground-muted">
            Access to this agency has been paused by AutoCut. Your work is safe;
            contact your account manager to restore it.
          </p>
        </div>
      ))}
      <div className="card flex items-center justify-between p-4">
        <p className="text-sm">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
        <form action={signOut}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

async function getFirstOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;

  const { data } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.user.id)
    .eq("seat_active", true)
    .limit(1)
    .maybeSingle();

  return data?.org_id ?? null;
}
