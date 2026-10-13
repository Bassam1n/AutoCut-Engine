import "server-only";
import { createClient } from "./supabase/server";

/**
 * Brand/ad/asset access checks for server actions that go on to use the
 * service client (which bypasses RLS). Each one reads through the
 * caller's own RLS-scoped client, so "not found" means "doesn't exist
 * OR the caller isn't allowed to see it" (wrong org, or a brand that
 * isn't assigned to them, migration 54). Call these before any
 * service-client work keyed by ids that came from the browser.
 */

export async function canAccessBrand(orgId: string, brandId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brands")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", brandId)
    .maybeSingle();
  return Boolean(data);
}

export type AccessibleAd = { id: string; brand_id: string; product_id: string | null };

/** The ad, if the caller can see it; when brandId is given it must also be the ad's brand. */
export async function getAccessibleAd(
  orgId: string,
  adId: string,
  brandId?: string
): Promise<AccessibleAd | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ads")
    .select("id, brand_id, product_id")
    .eq("org_id", orgId)
    .eq("id", adId)
    .maybeSingle();
  if (!data) return null;
  if (brandId && data.brand_id !== brandId) return null;
  return data;
}

/** Whether sceneId is a scene of adId that the caller can see. */
export async function sceneBelongsToAd(orgId: string, adId: string, sceneId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scenes")
    .select("id")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", sceneId)
    .maybeSingle();
  return Boolean(data);
}

export type AccessibleAsset = {
  id: string;
  storage_path: string;
  ad_id: string | null;
  scene_id: string | null;
  brand_id: string | null;
};

/** The asset, if the caller can see it (assets_select is brand/ad scoped). */
export async function getAccessibleAsset(orgId: string, assetId: string): Promise<AccessibleAsset | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assets")
    .select("id, storage_path, ad_id, scene_id, brand_id")
    .eq("org_id", orgId)
    .eq("id", assetId)
    .maybeSingle();
  return data ?? null;
}

/** Whether jobId is a job the caller can see (jobs_select is ad scoped). */
export async function canAccessJob(orgId: string, jobId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * For storage paths the browser hands back after an upload: the path
 * must sit under the folder this action reserved for it, so a caller
 * can't point the service-role signer at someone else's file.
 */
export function isPathUnder(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("//");
}
