"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCanManageBrandContent } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createProduct(
  orgId: string,
  brandId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireCanManageBrandContent(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Product name is required." };

  const category = String(formData.get("category") ?? "").trim();
  const whatItIs = String(formData.get("what_it_is") ?? "").trim();
  const realWorldSize = String(formData.get("real_world_size") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      org_id: orgId,
      brand_id: brandId,
      name,
      category: category || null,
      what_it_is: whatItIs || null,
      real_world_size: realWorldSize || null,
      url: url || null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products`);
  redirect(`/org/${orgId}/brands/${brandId}/products/${data.id}`);
}

export async function updateProduct(
  orgId: string,
  brandId: string,
  productId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireCanManageBrandContent(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Product name is required." };

  const category = String(formData.get("category") ?? "").trim();
  const whatItIs = String(formData.get("what_it_is") ?? "").trim();
  const realWorldSize = String(formData.get("real_world_size") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      name,
      category: category || null,
      what_it_is: whatItIs || null,
      real_world_size: realWorldSize || null,
      url: url || null,
    })
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products`);
  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}`);
  return { ok: true };
}

export async function archiveProduct(
  orgId: string,
  brandId: string,
  productId: string
): Promise<ActionResult> {
  await requireCanManageBrandContent(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ active: false })
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products`);
  return { ok: true };
}

/**
 * Reserves a storage path for a new product reference upload. The
 * browser uploads the file directly to Storage with its own session
 * (never through this server, per spec §6/M2: "Vercel body limit is
 * about 4.5 MB, so never post files through a route") — this action
 * only computes the path server-side, so the {org_id}/... prefix the
 * refs bucket's RLS policies check against is never client-controlled,
 * and records the product_refs row once the browser confirms the
 * upload succeeded.
 */
export async function reserveProductRefPath(
  orgId: string,
  productId: string,
  fileName: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  await requireCanManageBrandContent(orgId);

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/products/${productId}/${Date.now()}_${safeName}`;

  return { ok: true, path };
}

export async function recordProductRef(
  orgId: string,
  brandId: string,
  productId: string,
  kind: "photo" | "angle" | "alternate",
  name: string,
  storagePath: string
): Promise<ActionResult> {
  await requireCanManageBrandContent(orgId);

  const supabase = await createClient();
  const { error } = await supabase.from("product_refs").insert({
    org_id: orgId,
    product_id: productId,
    kind,
    name: name || null,
    storage_path: storagePath,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}`);
  return { ok: true };
}
