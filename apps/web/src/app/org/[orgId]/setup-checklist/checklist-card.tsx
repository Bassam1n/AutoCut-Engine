import Link from "next/link";
import type { SetupChecklist } from "./checklist-data";
import { isChecklistComplete } from "./checklist-data";

export function ChecklistCard({
  orgId,
  checklist,
}: {
  orgId: string;
  checklist: SetupChecklist;
}) {
  if (isChecklistComplete(checklist)) return null;

  const items = [
    {
      done: checklist.anthropicKeyVerified,
      label: "Verify an Anthropic key",
      href: `/org/${orgId}/settings/keys`,
    },
    {
      done: checklist.imageProviderKeyVerified,
      label: "Verify an image provider key (kie.ai, fal.ai or Higgsfield)",
      href: `/org/${orgId}/settings/keys`,
    },
    {
      done: checklist.brandWithProduct,
      label: "Add a brand with at least one product",
      href: `/org/${orgId}/brands`,
    },
  ];

  return (
    <div className="card p-4">
      <p className="mb-3 text-sm font-semibold">Finish setup before generating</p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  item.done
                    ? "bg-accent-soft text-accent"
                    : "border border-border-strong text-foreground-muted"
                }`}
              >
                {item.done ? "✓" : ""}
              </span>
              <span className={item.done ? "text-foreground-muted line-through" : ""}>
                {item.label}
              </span>
            </span>
            {!item.done && (
              <Link href={item.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
                Go
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
