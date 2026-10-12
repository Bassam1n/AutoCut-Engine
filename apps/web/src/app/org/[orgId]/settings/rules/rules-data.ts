import "server-only";
import { createClient } from "@/lib/supabase/server";

export type RuleRow = {
  id: string;
  org_id: string;
  scope: "org" | "brand" | "style" | "product";
  scope_id: string | null;
  kind: "do" | "avoid";
  text: string;
  confidence: number;
  reinforced_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Every rule for the org, newest first. rules_select (migration 10)
 * has no admin restriction — any org member can read — so this needs
 * no admin gate itself; settings/rules/page.tsx's requireOrgMember()
 * is the page-level gate, same split as spend-data.ts's
 * getOrgSpendStatus.
 */
export async function getOrgRules(orgId: string): Promise<RuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .select("*")
    .eq("org_id", orgId)
    .order("active", { ascending: false })
    .order("confidence", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export type ScopeNameLookup = {
  brands: Record<string, string>;
  styles: Record<string, string>;
  products: Record<string, string>;
};

/**
 * Resolves brand/style/product names for every non-null scope_id
 * across the org's rules, so the screen can show "Brand: Acme" rather
 * than a bare uuid. Best-effort: a scope_id whose row has since been
 * deleted just won't appear in the lookup, and the screen falls back
 * to showing the raw id in that case.
 */
export async function getScopeNameLookup(orgId: string, rules: RuleRow[]): Promise<ScopeNameLookup> {
  const supabase = await createClient();

  const brandIds = unique(rules.filter((r) => r.scope === "brand").map((r) => r.scope_id));
  const styleIds = unique(rules.filter((r) => r.scope === "style").map((r) => r.scope_id));
  const productIds = unique(rules.filter((r) => r.scope === "product").map((r) => r.scope_id));

  const [brandsResult, stylesResult, productsResult] = await Promise.all([
    brandIds.length
      ? supabase.from("brands").select("id, name").eq("org_id", orgId).in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
    styleIds.length
      ? supabase.from("styles").select("id, name").in("id", styleIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from("products").select("id, name").eq("org_id", orgId).in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  return {
    brands: toNameMap(brandsResult.data),
    styles: toNameMap(stylesResult.data),
    products: toNameMap(productsResult.data),
  };
}

function unique(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => id !== null)));
}

function toNameMap(rows: { id: string; name: string }[] | null): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows ?? []) map[row.id] = row.name;
  return map;
}
