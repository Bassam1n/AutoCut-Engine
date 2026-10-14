import Link from "next/link";
import { describeAction, type ActivityRow } from "./data";
import { formatRelative } from "./ui";

export function ActivityList({ rows, showAgency }: { rows: ActivityRow[]; showAgency: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-foreground-muted">No activity yet.</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 border-t border-border py-2 text-sm first:border-t-0">
          {showAgency && (
            <Link href={`/platform-admin/agencies/${row.org_id}`} className="font-medium hover:underline">
              {row.org_name}
            </Link>
          )}
          <span className={showAgency ? "" : "font-medium"}>{describeAction(row.action)}</span>
          {row.target && <span className="max-w-xs truncate text-xs text-foreground-muted">{row.target}</span>}
          {row.actor_email && <span className="text-xs text-foreground-muted">by {row.actor_email}</span>}
          <span className="ml-auto text-xs text-foreground-muted">{formatRelative(row.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
