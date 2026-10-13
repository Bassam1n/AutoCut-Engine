import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BrandCastMemberRow = {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  description: string | null;
  ref_asset_id: string | null;
  sheet_asset_id: string | null;
  active: boolean;
  created_at: string;
};

export async function getAllBrandCastMembers(orgId: string, brandId: string): Promise<BrandCastMemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_cast_members")
    .select("id, org_id, brand_id, name, description, ref_asset_id, sheet_asset_id, active, created_at")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Same batched-signing pattern as every other asset query in this app. */
export async function getBrandCastAssetUrls(orgId: string, assetIds: string[]): Promise<Record<string, string>> {
  if (assetIds.length === 0) return {};

  const supabase = await createClient();
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .in("id", assetIds);
  if (error) throw new Error(error.message);

  const paths = (assets ?? []).map((a) => a.storage_path);
  if (paths.length === 0) return {};

  const { data: signedData } = await supabase.storage.from("renders").createSignedUrls(paths, 3600);
  const signedByPath = new Map((signedData ?? []).map((d) => [d.path, d.signedUrl]));

  const result: Record<string, string> = {};
  for (const asset of assets ?? []) {
    const url = signedByPath.get(asset.storage_path);
    if (url) result[asset.id] = url;
  }
  return result;
}
