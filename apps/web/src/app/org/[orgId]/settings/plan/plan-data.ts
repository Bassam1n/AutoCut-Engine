import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/plans";

export type OrgUsage = {
  plan: Plan;
  paid_until: string | null;
  seat_cap: number | null;
  seats_used: number;
  brand_cap: number | null;
  brands_used: number;
  storage_quota_gb: number | null;
  storage_bytes: number;
};

export type OrgPayment = {
  id: string;
  amount: number;
  currency: string;
  paid_on: string;
  period_end: string;
};

/** Owner and admin only (org_usage raises for anyone else). */
export async function getOrgUsage(orgId: string): Promise<OrgUsage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_usage", { target_org_id: orgId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0];
  if (!row) return null;
  return { ...row, storage_bytes: Number(row.storage_bytes) } as OrgUsage;
}

export async function getOrgPayments(orgId: string): Promise<OrgPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_payments")
    .select("id, amount, currency, paid_on, period_end")
    .eq("org_id", orgId)
    .is("voided_at", null)
    .order("paid_on", { ascending: false })
    .limit(24);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
}

/** paid_until for the billing banner; any member can read their own org row. */
export async function getOrgPaidUntil(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("paid_until").eq("id", orgId).maybeSingle();
  return (data?.paid_until as string | null | undefined) ?? null;
}
