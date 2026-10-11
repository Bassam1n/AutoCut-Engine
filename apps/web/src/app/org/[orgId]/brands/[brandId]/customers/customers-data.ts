import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CustomerProfile = {
  age_range?: string;
  pains?: string;
  desired_outcome?: string;
};

export type Customer = {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  profile: CustomerProfile;
  created_at: string;
  updated_at: string;
};

export async function getCustomers(orgId: string, brandId: string): Promise<Customer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}
