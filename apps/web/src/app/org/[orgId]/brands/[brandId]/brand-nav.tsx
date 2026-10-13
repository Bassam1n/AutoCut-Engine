import Link from "next/link";

/** Shared brand-level tab nav — was duplicated per-page (customers/products) before the Cast library page added a 3rd tab; extracted rather than copy-pasting a 3rd near-identical block. */
export function BrandNav({
  orgId,
  brandId,
  active,
}: {
  orgId: string;
  brandId: string;
  active: "customers" | "products" | "cast" | "settings";
}) {
  const tabs = [
    { id: "customers" as const, label: "Customers", href: `/org/${orgId}/brands/${brandId}/customers` },
    { id: "products" as const, label: "Products", href: `/org/${orgId}/brands/${brandId}/products` },
    { id: "cast" as const, label: "Cast library", href: `/org/${orgId}/brands/${brandId}/cast` },
    { id: "settings" as const, label: "Settings", href: `/org/${orgId}/brands/${brandId}/settings/keys` },
  ];

  return (
    <div className="flex gap-2 border-b border-border pb-3">
      {tabs.map((tab) =>
        tab.id === active ? (
          <span key={tab.id} className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent">
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.id}
            href={tab.href}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-border/40"
          >
            {tab.label}
          </Link>
        )
      )}
    </div>
  );
}
