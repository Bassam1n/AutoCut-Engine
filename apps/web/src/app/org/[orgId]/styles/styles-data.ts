import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Style = {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  categories: string[];
  masterprompt: string | null;
  preview_image_url: string | null;
  active: boolean;
};

export async function getVisibleStyles(orgId: string): Promise<Style[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("styles")
    .select("id, org_id, name, description, categories, masterprompt, preview_image_url, active")
    .eq("active", true)
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getFavouriteStyleIds(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_style_favourites")
    .select("style_id")
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.style_id));
}
