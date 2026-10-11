import { getAdSpend, groupSpendByKind } from "../spend-data";

/**
 * Per-step cost breakdown for one ad, shown in the Studio so the
 * editor always knows what each pipeline step has actually spent —
 * scripts, scene plan, concept pitch, cast extraction, storyboard,
 * plus any image generation triggered along the way.
 */
export async function CostBreakdown({ orgId, adId }: { orgId: string; adId: string }) {
  const events = await getAdSpend(orgId, adId);
  if (events.length === 0) return null;

  const grouped = groupSpendByKind(events);
  const total = grouped.reduce((sum, g) => sum + g.usd, 0);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background-raised/50 p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium text-foreground-muted">Cost so far</p>
        <p className="font-semibold">${total.toFixed(4)}</p>
      </div>
      <div className="flex flex-col gap-1">
        {grouped.map((g) => (
          <div key={g.kind} className="flex items-center justify-between text-foreground-muted">
            <span>
              {g.label}
              {g.count > 1 && <span className="ml-1 text-foreground-muted/60">×{g.count}</span>}
            </span>
            <span>${g.usd.toFixed(4)}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-foreground-muted/60">Estimates — see spend_events / price_table.</p>
    </div>
  );
}
