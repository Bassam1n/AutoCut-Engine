import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AdScriptRow = {
  id: string;
  org_id: string;
  ad_id: string;
  variant_index: 1 | 2 | 3;
  hook: string;
  body: string;
  cta: string;
  selected: boolean;
  created_at: string;
};

export async function getAdScripts(orgId: string, adId: string): Promise<AdScriptRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_scripts")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .order("variant_index");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCategoryToneNotes(category: string | null): Promise<string | null> {
  if (!category) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_templates")
    .select("tone_notes")
    .eq("category", category)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.tone_notes ?? null;
}
