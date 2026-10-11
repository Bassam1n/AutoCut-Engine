"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";
import type { CustomerProfile } from "./customers-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

function readProfile(formData: FormData): CustomerProfile {
  const profile: CustomerProfile = {};
  for (const key of ["age_range", "pains", "desired_outcome"] as const) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) profile[key] = value;
  }
  return profile;
}

export async function createCustomer(
  orgId: string,
  brandId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    org_id: orgId,
    brand_id: brandId,
    name,
    profile: readProfile(formData),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/customers`);
  return { ok: true };
}

export async function updateCustomer(
  orgId: string,
  brandId: string,
  customerId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ name, profile: readProfile(formData) })
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", customerId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/customers`);
  return { ok: true };
}

