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
  target_length_seconds: number | null;
  plan_locked: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function getAds(orgId: string, productId: string): Promise<Ad[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ads")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

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
