import "server-only";
import { createClient } from "@/lib/supabase/server";

export type BrandContext = {
  audience?: string;
  tone?: string;
  product_facts?: string;
  visual_feel?: string;
  never_generate?: string;
  claims_rules?: string;
};

export type Brand = {
  id: string;
  org_id: string;
  name: string;
  logo_url: string | null;
  brand_context: BrandContext;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getBrands(orgId: string): Promise<Brand[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getBrand(orgId: string, brandId: string): Promise<Brand | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", brandId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}
