"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { AdBrief } from "./ads-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createAd(
  orgId: string,
  brandId: string,
  productId: string,
  styleId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ads")
    .insert({
      org_id: orgId,
      brand_id: brandId,
      product_id: productId,
      style_id: styleId,
      mode: "studio",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads`);
  redirect(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${data.id}`);
}

export async function saveBrief(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  brief: AdBrief
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ brief })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

export async function lockPlan(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("ads")
    .update({ plan_locked: true })
    .eq("org_id", orgId)
    .eq("id", adId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
