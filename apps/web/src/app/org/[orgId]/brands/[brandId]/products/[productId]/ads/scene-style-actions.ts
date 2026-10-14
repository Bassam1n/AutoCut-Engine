"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd, sceneBelongsToAd } from "@/lib/access";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sets (or clears, with null) one scene's own style. Mixed-style ads cut
 * between looks scene by scene (a UGC talking head, then a 3D anatomy
 * cutaway); null puts the scene back on the ad's style. Already-generated
 * images keep their look until the scene is regenerated.
 */
export async function setSceneStyle(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  sceneId: string,
  styleId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId, brandId))) return { ok: false, error: "Ad not found." };
  if (!(await sceneBelongsToAd(orgId, adId, sceneId))) return { ok: false, error: "Scene not found." };

  const supabase = await createClient();
  if (styleId) {
    // Built-in styles or this org's own; never another agency's.
    const { data: style } = await supabase
      .from("styles")
      .select("id, org_id, active")
      .eq("id", styleId)
      .maybeSingle();
    if (!style || !style.active || (style.org_id !== null && style.org_id !== orgId)) {
      return { ok: false, error: "That style isn't available." };
    }
  }

  const { error } = await supabase
    .from("scenes")
    .update({ style_id: styleId })
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .eq("id", sceneId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
