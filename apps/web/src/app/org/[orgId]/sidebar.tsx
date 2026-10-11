"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions";
import type { SidebarInfo } from "./sidebar-data";

export function Sidebar({
  orgId,
  info,
}: {
  orgId: string;
  info: SidebarInfo;
}) {
  const pathname = usePathname();

  const links = [
    { href: `/org/${orgId}/brands`, label: "Brands" },
    ...(info.isAdmin ? [{ href: `/org/${orgId}/team`, label: "Team" }] : []),
  ];

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-background-raised">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-ink">
          AC
        </div>
        <span className="text-sm font-semibold tracking-tight">
          AutoCut Engine
        </span>
      </div>

      <p className="truncate px-5 pb-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
        {info.orgName}
      </p>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {links.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-foreground hover:bg-border/40"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
        <p className="truncate text-xs text-foreground-muted">
          {info.userEmail}
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg border border-border-strong px-3 py-1.5 text-left text-sm font-medium transition-colors hover:bg-border/40"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
