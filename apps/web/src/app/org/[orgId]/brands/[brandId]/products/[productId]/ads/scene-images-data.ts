import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SceneImageAsset = {
  id: string;
  org_id: string;
  ad_id: string;
  scene_id: string | null;
  kind: string;
  version: number;
  archived: boolean;
  storage_path: string;
  source: string | null;
  qa: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at: string;
};

/** Non-archived generated images for every scene of this ad, newest version last, grouped by scene. */
export async function getSceneImages(orgId: string, adId: string): Promise<Record<string, SceneImageAsset[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "image")
    .eq("archived", false)
    .order("version", { ascending: true });

  if (error) throw new Error(error.message);

  const bySceneId: Record<string, SceneImageAsset[]> = {};
  for (const asset of data ?? []) {
    if (!asset.scene_id) continue;
    (bySceneId[asset.scene_id] ??= []).push(asset);
  }
  return bySceneId;
}

/** Archived image assets — archived by submitImageFeedback() as a side effect whenever Tweak/Rework replaces a scene's current image with a rewritten one. Mirrors scene-videos-data.ts's getArchivedSceneVideos exactly. */
export async function getArchivedSceneImages(orgId: string, adId: string): Promise<Record<string, SceneImageAsset[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "image")
    .eq("archived", true)
    .order("version", { ascending: true });

  if (error) throw new Error(error.message);

  const bySceneId: Record<string, SceneImageAsset[]> = {};
  for (const asset of data ?? []) {
    if (!asset.scene_id) continue;
    (bySceneId[asset.scene_id] ??= []).push(asset);
  }
  return bySceneId;
}

/** Attached feedback images (assets.kind='feedback'), grouped by scene — spec §5.6 reference tier (b). */
export async function getSceneFeedbackImages(orgId: string, adId: string): Promise<Record<string, SceneImageAsset[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("kind", "feedback")
    .eq("archived", false)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const bySceneId: Record<string, SceneImageAsset[]> = {};
  for (const asset of data ?? []) {
    if (!asset.scene_id) continue;
    (bySceneId[asset.scene_id] ??= []).push(asset);
  }
  return bySceneId;
}

export async function getAssetSignedUrlsByPath(storagePaths: string[]): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("renders").createSignedUrls(storagePaths, 3600);
  if (error) throw new Error(error.message);

  const result: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) result[entry.path] = entry.signedUrl;
  }
  return result;
}

export type ActiveRule = {
  id: string;
  scope: "org" | "brand" | "style" | "product";
  scope_id: string | null;
  kind: "do" | "avoid";
  text: string;
};

/**
 * Active rules relevant to this ad — spec §5.8: scoped to org, brand,
 * style or product. No population code exists yet (that's a later
 * milestone), so this will just return an empty array for now; that's
 * expected and correct, not special-cased here.
 */
export async function getActiveRulesForAd(
  orgId: string,
  brandId: string,
  styleId: string | null,
  productId: string | null
): Promise<ActiveRule[]> {
  const supabase = await createClient();
  const scopeIds = [orgId, brandId, styleId, productId].filter((id): id is string => id !== null);

  const { data, error } = await supabase
    .from("rules")
    .select("id, scope, scope_id, kind, text")
    .eq("org_id", orgId)
    .eq("active", true)
    .or(`scope_id.is.null,scope_id.in.(${scopeIds.join(",")})`);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export type ProductSpecRow = {
  id: string;
  org_id: string;
  product_id: string;
  version: number;
  spec: Record<string, unknown>;
  source: "vision" | "human";
  approved: boolean;
  created_at: string;
};

/** The latest product_specs row for a product, or null if none exists yet. */
export async function getLatestProductSpec(orgId: string, productId: string): Promise<ProductSpecRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_specs")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}
