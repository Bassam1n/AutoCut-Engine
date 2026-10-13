import { getAdSpend, groupSpendByKind } from "../spend-data";

/**
 * Per-step cost breakdown for one ad, shown in the Studio so the
 * editor always knows what each pipeline step has actually spent —
 * scripts, scene plan, concept pitch, cast extraction, storyboard,
 * plus any image generation triggered along the way.
 *
 * Redesigned per user feedback ("make it more appealing to the eye")
 * from a dense flat list of label/$amount rows into a proportional
 * bar-chart layout: each row's bar width is scaled to its share of the
 * total, giving an instant visual sense of where the budget actually
 * went instead of making the editor read every number to compare them.
 */
export async function CostBreakdown({ orgId, adId }: { orgId: string; adId: string }) {
  const events = await getAdSpend(orgId, adId);
  const grouped = groupSpendByKind(events);
  const total = grouped.reduce((sum, g) => sum + g.usd, 0);
  const max = grouped.length > 0 ? Math.max(...grouped.map((g) => g.usd)) : 0;

  return (
    <div className="card-inset flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Cost so far</p>
        <p className="text-xl font-semibold tabular-nums">${total.toFixed(2)}</p>
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Nothing generated yet — costs appear here as each step runs.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {grouped.map((g) => {
            const pct = max > 0 ? (g.usd / max) * 100 : 0;
            return (
              <div key={g.kind} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">
                    {g.label}
                    {g.count > 1 && <span className="ml-1 text-foreground-muted">×{g.count}</span>}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground-muted">
                    ${g.usd.toFixed(4)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-foreground-muted/60">Estimates — see spend_events / price_table.</p>
    </div>
  );
}
