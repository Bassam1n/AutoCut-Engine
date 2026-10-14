import { PLAN_LABELS, type AgencyStatus, type Plan } from "./model";

export function formatUsd(value: number, { precise = false }: { precise?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: precise || value < 100 ? 2 : 0,
    maximumFractionDigits: precise || value < 100 ? 2 : 0,
  }).format(value);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** `now` lets client components pass a server-supplied clock instead of reading Date.now() during prerender. */
export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Never";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

const STATUS_STYLES: Record<AgencyStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-accent-soft text-accent" },
  invite_pending: { label: "Invite pending", className: "border border-border-strong text-foreground-muted" },
  paused: { label: "Paused", className: "bg-danger-soft text-danger" },
  suspended: { label: "Suspended", className: "bg-foreground text-background" },
};

export function StatusBadge({ status }: { status: AgencyStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground-muted">
      {PLAN_LABELS[plan]}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
      {hint && <span className="text-xs text-foreground-muted">{hint}</span>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-foreground-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
