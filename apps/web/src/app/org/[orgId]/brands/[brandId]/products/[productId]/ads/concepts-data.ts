import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConceptOption } from "@/lib/claude/schemas/concepts";

export type Concept = {
  ad_id: string;
  org_id: string;
  options: ConceptOption[];
  selected_idx: number | null;
  locked_cast: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getConcept(orgId: string, adId: string): Promise<Concept | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("concepts")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export type CastMember = {
  id: string;
  org_id: string;
  ad_id: string;
  name: string;
  description: string | null;
  ref_asset_id: string | null;
  sheet_asset_id: string | null;
  brand_cast_member_id: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
};

export async function getCastMembers(orgId: string, adId: string): Promise<CastMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cast_members")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export type BrandCastMember = {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  description: string | null;
  ref_asset_id: string | null;
  sheet_asset_id: string | null;
  active: boolean;
};

export async function getBrandCastMembers(orgId: string, brandId: string): Promise<BrandCastMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_cast_members")
    .select("id, org_id, brand_id, name, description, ref_asset_id, sheet_asset_id, active")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAssetSignedUrls(
  orgId: string,
  assetIds: string[]
): Promise<Record<string, string>> {
  if (assetIds.length === 0) return {};

  const supabase = await createClient();
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .in("id", assetIds);

  if (error) throw new Error(error.message);
  if (!assets || assets.length === 0) return {};

  const paths = assets.map((a) => a.storage_path);
  const { data: signed, error: signError } = await supabase.storage
    .from("renders")
    .createSignedUrls(paths, 3600);
  if (signError) throw new Error(signError.message);

  const pathToUrl: Record<string, string> = {};
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) pathToUrl[entry.path] = entry.signedUrl;
  }

  const result: Record<string, string> = {};
  for (const asset of assets) {
    const url = pathToUrl[asset.storage_path];
    if (url) result[asset.id] = url;
  }
  return result;
}
