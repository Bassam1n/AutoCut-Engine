"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { BrandContext } from "./brands-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

function readBrandContext(formData: FormData): BrandContext {
  const context: BrandContext = {};
  for (const key of [
    "audience",
    "tone",
    "product_facts",
    "visual_feel",
    "never_generate",
    "claims_rules",
  ] as const) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) context[key] = value;
  }
  return context;
}

export async function createBrand(orgId: string, formData: FormData): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Brand name is required." };

  const logoUrl = String(formData.get("logo_url") ?? "").trim();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("brands")
    .insert({
      org_id: orgId,
      name,
      logo_url: logoUrl || null,
      brand_context: readBrandContext(formData),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands`);
  redirect(`/org/${orgId}/brands/${data.id}/customers`);
}

export async function updateBrand(
  orgId: string,
  brandId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Brand name is required." };

  const logoUrl = String(formData.get("logo_url") ?? "").trim();
  const supabase = await createClient();

  const { error } = await supabase
    .from("brands")
    .update({
      name,
      logo_url: logoUrl || null,
      brand_context: readBrandContext(formData),
    })
    .eq("org_id", orgId)
    .eq("id", brandId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands`);
  revalidatePath(`/org/${orgId}/brands/${brandId}/customers`);
  return { ok: true };
}

export async function archiveBrand(orgId: string, brandId: string): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("brands")
    .update({ active: false })
    .eq("org_id", orgId)
    .eq("id", brandId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands`);
  return { ok: true };
}
