import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProductCategory } from "./product-categories";

export type Product = {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  category: ProductCategory | null;
  what_it_is: string | null;
  url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductRef = {
  id: string;
  org_id: string;
  product_id: string;
  kind: "photo" | "angle" | "alternate";
  name: string | null;
  storage_path: string;
  created_at: string;
};

export async function getProducts(orgId: string, brandId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Every active product across every brand in the org, for the sidebar's Products page. */
export async function getAllOrgProducts(orgId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProduct(
  orgId: string,
  brandId: string,
  productId: string
): Promise<Product | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getProductRefs(orgId: string, productId: string): Promise<ProductRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_refs")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProductRefSignedUrls(
  orgId: string,
  refs: ProductRef[]
): Promise<Record<string, string>> {
  if (refs.length === 0) return {};

  const supabase = await createClient();
  const paths = refs.map((r) => r.storage_path);
  const { data, error } = await supabase.storage.from("refs").createSignedUrls(paths, 3600);

  if (error) throw new Error(error.message);

  const result: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) result[entry.path] = entry.signedUrl;
  }
  return result;
}
