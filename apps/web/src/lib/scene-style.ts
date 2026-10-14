import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EffectiveStyle = {
  styleId: string | null;
  name: string | null;
  masterprompt: string | null;
  referenceAssetId: string | null;
};

/**
 * The style that governs ONE scene: the scene's own override
 * (scenes.style_id, migration 61) when set, otherwise the ad's style.
 * Every per-scene generation (storyboard rewrite, image prompt, style
 * reference image, video prompt, feedback regeneration, style-scoped
 * rules) goes through this so a mixed-style ad stays consistent.
 */
export async function getEffectiveSceneStyle(
  supabase: SupabaseClient,
  adStyleId: string | null,
  sceneStyleId: string | null | undefined
): Promise<EffectiveStyle> {
  const styleId = sceneStyleId ?? adStyleId;
  if (!styleId) return { styleId: null, name: null, masterprompt: null, referenceAssetId: null };
  const { data } = await supabase
    .from("styles")
    .select("id, name, masterprompt, reference_asset_id")
    .eq("id", styleId)
    .maybeSingle();
  return {
    styleId: data?.id ?? styleId,
    name: data?.name ?? null,
    masterprompt: data?.masterprompt ?? null,
    referenceAssetId: data?.reference_asset_id ?? null,
  };
}
