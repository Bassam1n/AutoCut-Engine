import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SpendEvent = {
  id: string;
  provider: string;
  model: string | null;
  usd_est: number;
  kind: string;
  created_at: string;
};

const TASK_LABELS: Record<string, string> = {
  "llm:generate_ad_scripts": "Scripts",
  "llm:generate_scene_plan": "Scene plan",
  "llm:generate_concepts": "Concept pitch",
  "llm:extract_cast": "Cast extraction",
  "llm:generate_scene_visuals": "Storyboard (Visual Director)",
  "llm:example_extraction": "Extraction",
};

export function spendKindLabel(kind: string): string {
  if (TASK_LABELS[kind]) return TASK_LABELS[kind];
  if (kind.startsWith("llm:")) return kind.slice(4);
  if (kind.startsWith("image:")) return `Image — ${kind.slice(6)}`;
  return kind;
}

export async function getAdSpend(orgId: string, adId: string): Promise<SpendEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spend_events")
    .select("id, provider, model, usd_est, kind, created_at")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SpendByKind = { kind: string; label: string; usd: number; count: number };

export function groupSpendByKind(events: SpendEvent[]): SpendByKind[] {
  const groups = new Map<string, { usd: number; count: number }>();
  for (const event of events) {
    const existing = groups.get(event.kind) ?? { usd: 0, count: 0 };
    existing.usd += event.usd_est;
    existing.count += 1;
    groups.set(event.kind, existing);
  }
  return Array.from(groups.entries())
    .map(([kind, { usd, count }]) => ({ kind, label: spendKindLabel(kind), usd, count }))
    .sort((a, b) => b.usd - a.usd);
}
