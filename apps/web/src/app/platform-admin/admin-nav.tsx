"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/platform-admin", label: "Overview", exact: true },
  { href: "/platform-admin/agencies", label: "Agencies" },
  { href: "/platform-admin/requests", label: "Access requests" },
  { href: "/platform-admin/activity", label: "Activity" },
  { href: "/platform-admin/styles", label: "Styles" },
  { href: "/platform-admin/prompts", label: "Agent prompts" },
  { href: "/platform-admin/admins", label: "Platform admins" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {LINKS.map((link) => {
        const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
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
  );
}
