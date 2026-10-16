"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions";
import { buttonVariantsSm } from "@/components/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/avatar";
import { ROLE_LABELS } from "@/lib/roles";
import { CreateAdButton } from "./create-ad-button";
import { NotificationBell } from "./notification-bell";
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
    // Task board for owners/admins; users get only their own tasks.
    ...(info.isAdmin
      ? [{ href: `/org/${orgId}/board`, label: "Board" }]
      : [{ href: `/org/${orgId}/tasks`, label: "My tasks" }]),
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
    { href: `/org/${orgId}/tutorials`, label: "Tutorials" },
    // Spend & guard: owner and admin only; the audit log and Resume
    // inside it are owner-only.
    ...(info.isAdmin ? [{ href: `/org/${orgId}/settings/spend`, label: "Spend & guard" }] : []),
    ...(info.isAdmin ? [{ href: `/org/${orgId}/settings/plan`, label: "Plan & usage" }] : []),
    // Rules is visible to every member for the same reason Spend &
    // guard is — rules_select (migration 10) has no admin
    // restriction, and an editor benefits from seeing why generations
    // look the way they do, even though editing/pausing/deleting a
    // rule stays admin-only within the page itself (settings/rules's
    // isOrgAdmin() check, same split as Spend & guard).
    { href: `/org/${orgId}/settings/rules`, label: "Rules" },
    // Team: owner manages it, admins see it read-only (migration 52).
    ...(info.isAdmin ? [{ href: `/org/${orgId}/team`, label: "Team" }] : []),
    // Org-wide keys are owner-only; brand keys stay owner+admin.
    ...(info.role === "owner"
      ? [{ href: `/org/${orgId}/settings/keys`, label: "Org-wide keys" }]
      : []),
  ];

  return (
    <aside className="sticky top-4 flex h-[calc(100vh-2rem)] w-64 shrink-0 flex-col self-start overflow-y-auto rounded-3xl bg-background-raised px-3 py-5 shadow-[var(--shadow-sidebar)]">
      <div className="flex items-center gap-3 px-2 pb-5">
        {/* logo-mark.png is logo.png cropped to the mark (the original is
            mostly transparent padding, which shrank the mark to ~12px). */}
        <Image
          src="/logo-mark.png"
          alt=""
          width={360}
          height={144}
          priority
          className="h-10 w-auto shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {info.orgName}
        </span>
        <NotificationBell orgId={orgId} unreadCount={info.unreadNotifications} />
      </div>

      {info.canCreateAds && (
        <div className="pb-3">
          <CreateAdButton orgId={orgId} />
        </div>
      )}

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
        <Link
          href={`/org/${orgId}/profile`}
          className={`-mx-1 flex items-center gap-2.5 rounded-xl px-1 py-1 transition-colors hover:bg-border/40 ${
            pathname.startsWith(`/org/${orgId}/profile`) ? "bg-border/40" : ""
          }`}
        >
          <Avatar name={info.fullName} email={info.userEmail} avatarPath={info.avatarPath} size={32} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{info.fullName?.trim() || "My profile"}</span>
            <span className="truncate text-xs text-foreground-muted">
              {info.role ? ROLE_LABELS[info.role] : info.userEmail}
            </span>
          </span>
        </Link>
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
