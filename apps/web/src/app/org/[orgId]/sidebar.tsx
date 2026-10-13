"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions";
import { buttonVariantsSm } from "@/components/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CreateAdButton } from "./create-ad-button";
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
    { href: `/org/${orgId}/products`, label: "Products" },
    { href: `/org/${orgId}/creative-history`, label: "Creative history" },
    // Visible to every member, same as the links below it — library_items
    // has no admin-only RLS restriction (migration 10:
    // library_items_select/_insert/_update/_delete all just check
    // is_org_member(org_id), no role check), so there's no reason to
    // gate this behind info.isAdmin the way Team/Provider keys are.
    { href: `/org/${orgId}/library`, label: "Library" },
    { href: `/org/${orgId}/styles`, label: "Styles" },
    // Spend & guard is visible to every member (orgs_select_own lets
    // any member read warn/stop thresholds and paused state directly
    // — see settings/spend/page.tsx) even though the audit log and
    // Resume button inside it stay admin-only, so this link isn't
    // gated behind info.isAdmin the way Team/Provider keys are.
    { href: `/org/${orgId}/settings/spend`, label: "Spend & guard" },
    // Rules is visible to every member for the same reason Spend &
    // guard is — rules_select (migration 10) has no admin
    // restriction, and an editor benefits from seeing why generations
    // look the way they do, even though editing/pausing/deleting a
    // rule stays admin-only within the page itself (settings/rules's
    // isOrgAdmin() check, same split as Spend & guard).
    { href: `/org/${orgId}/settings/rules`, label: "Rules" },
    ...(info.isAdmin
      ? [
          { href: `/org/${orgId}/team`, label: "Team" },
          { href: `/org/${orgId}/settings/keys`, label: "Org-wide keys" },
        ]
      : []),
  ];

  return (
    <aside className="sticky top-4 flex h-[calc(100vh-2rem)] w-64 shrink-0 flex-col self-start overflow-y-auto rounded-3xl bg-background-raised px-3 py-5 shadow-[var(--shadow-sidebar)]">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <div className="relative h-8 w-8 shrink-0">
          <Image src="/logo.png" alt="" fill className="object-contain" />
        </div>
        <span className="truncate text-sm font-semibold tracking-tight">
          {info.orgName}
        </span>
      </div>

      <div className="pb-3">
        <CreateAdButton orgId={orgId} />
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {links.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-3.5 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-accent-soft text-accent shadow-[var(--shadow-soft)]"
                  : "text-foreground-muted hover:bg-border/40 hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 rounded-2xl bg-background px-3 py-3">
        <p className="truncate text-xs text-foreground-muted">
          {info.userEmail}
        </p>
        <ThemeToggle />
        <form action={signOut}>
          <button type="submit" className={`w-full justify-start ${buttonVariantsSm.secondary}`}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
