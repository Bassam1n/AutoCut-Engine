import "server-only";
import { createClient } from "@/lib/supabase/server";

export const PLAN_COOKIE = "hf_plan_oauth";
export const CALLBACK_PATH = "/api/higgsfield-plan/callback";

export type PlanOAuthState = {
  state: string;
  verifier: string;
  clientId: string;
  orgId: string;
  brandId: string;
  redirectUri: string;
};

/** True when the signed-in user is an admin of orgId and brandId belongs to it. */
export async function canManageBrandKeys(orgId: string, brandId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_org_admin", { check_org_id: orgId });
  if (!isAdmin) return false;
  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("org_id", orgId).maybeSingle();
  return Boolean(brand);
}

export function keysPageUrl(origin: string, orgId: string, brandId: string, params: Record<string, string>): URL {
  const url = new URL(`/org/${orgId}/brands/${brandId}/settings/keys`, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
