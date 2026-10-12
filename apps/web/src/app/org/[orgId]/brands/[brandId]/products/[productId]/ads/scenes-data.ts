import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SceneNote = { type: "idea" | "rule"; text: string };

export type Scene = {
  id: string;
  org_id: string;
  ad_id: string;
  idx: number;
  hook_group: "hook_1" | "hook_2" | "hook_3" | "body" | "cta" | null;
  copy: string;
  visual: string;
  product_id: string | null;
  duration_s: number | null;
  route: "stock-friendly" | "generated" | "overlay-only" | "hybrid" | null;
  notes: SceneNote | Record<string, never>;
  speaker: string | null;
  status: string;
  /** Spec §5.6 "sticky prompt override" — set once the editor saves an exact final prompt; sticks across regenerations until explicitly reset (null). */
  image_prompt_override: string | null;
  /** Spec §5.7 "Optional video idea text per scene" — free text that steers this scene's motion/animation, independent of Visual/copy. Nullable (migration 42). */
  video_idea: string | null;
  created_at: string;
  updated_at: string;
};

export async function getScenes(orgId: string, adId: string): Promise<Scene[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .order("idx");

  if (error) throw new Error(error.message);
  return data ?? [];
}
