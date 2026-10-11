import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AdBrief = {
  hooks?: string[];
  body?: string;
  cta?: string;
  idea?: string;
};

export type Ad = {
  id: string;
  org_id: string;
  brand_id: string;
  product_id: string;
  style_id: string | null;
  mode: "studio" | "autopilot";
  brief: AdBrief;
  name: string | null;
  archived: boolean;
  target_length_seconds: number | null;
  plan_locked: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AdWithContext = Ad & {
  brand_name: string;
  product_name: string;
};

/** Every ad across the whole org (every brand, every product), with its brand/product names joined in, for the sidebar's Creative History page. */
export async function getAllOrgAds(
  orgId: string,
  options: { includeArchived?: boolean } = {}
): Promise<AdWithContext[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ads")
    .select("*, brands!inner(name), products!inner(name)")
    .eq("org_id", orgId);

  if (!options.includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { brands, products, ...ad } = row as Ad & {
      brands: { name: string };
      products: { name: string };
    };
    return { ...ad, brand_name: brands.name, product_name: products.name };
  });
}

export async function getAds(
  orgId: string,
  productId: string,
  options: { includeArchived?: boolean } = {}
): Promise<Ad[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ads")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId);

  if (!options.includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAd(orgId: string, productId: string, adId: string): Promise<Ad | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ads")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .eq("id", adId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}
