import { Suspense } from "react";
import Image from "next/image";
import { requirePlatformAdmin } from "@/lib/auth";
import { signOut } from "../actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { AdminNav } from "./admin-nav";

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col overflow-y-auto md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:w-60 md:self-start rounded-3xl bg-background-raised px-3 py-5 shadow-[var(--shadow-sidebar)]">
        <div className="flex items-center gap-3 px-2 pb-5">
          <Image src="/logo-mark.png" alt="" width={360} height={144} priority className="h-9 w-auto shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Platform</span>
        </div>
        <Suspense fallback={<NavSkeleton />}>
          <GatedSidebarBody />
        </Suspense>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-full bg-border" />
      ))}
    </div>
  );
}

async function GatedSidebarBody() {
  const user = await requirePlatformAdmin();
  return (
    <>
      <AdminNav />
      <div className="flex flex-col gap-2 rounded-2xl bg-background px-3 py-3">
        <p className="truncate text-xs text-foreground-muted">{user.email}</p>
        <ThemeToggle />
        <form action={signOut}>
          <button type="submit" className="btn-secondary btn-sm w-full justify-start">
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
