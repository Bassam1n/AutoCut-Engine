"use server";

import { storageFullError } from "@/lib/storage-quota";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { isPathUnder } from "@/lib/access";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Brand Cast Library (editor feedback: "manually create a cast... or
 * upload a cast image manually, instead of just having the option of
 * AI do it," plus "save the character sheet... to utilize the same
 * character again in any other video"). The `brand_cast_members`
 * table and its matching logic inside extractCast already existed
 * (migration 00000000000036) but had zero UI — this is that UI's
 * actions layer, giving an editor a path to create/manage personas
 * directly instead of only ever getting one from Claude's implicit
 * "new character" insert.
 */
export async function createBrandCastMember(
  orgId: string,
  brandId: string,
  name: string,
  description: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("brand_cast_members").insert({
    org_id: orgId,
    brand_id: brandId,
    name: trimmedName,
    description: description.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/cast`);
  return { ok: true };
}

export async function updateBrandCastMember(
  orgId: string,
  brandId: string,
  memberId: string,
  name: string,
  description: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_cast_members")
    .update({ name: trimmedName, description: description.trim() || null })
    .eq("org_id", orgId)
    .eq("id", memberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/cast`);
  return { ok: true };
}

/** Soft-remove, never delete — matches this project's standing "archive, never delete" convention (assets.archived, cast_members stays, orgs.paused, etc). A deactivated persona stops showing up for new ads but any past ad's cast_members row that already points at it keeps working. */
export async function deactivateBrandCastMember(orgId: string, brandId: string, memberId: string): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_cast_members")
    .update({ active: false })
    .eq("org_id", orgId)
    .eq("id", memberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/cast`);
  return { ok: true };
}

/** Same upload-path convention as reserveCastReferenceUploadPath (concepts-actions.ts) — kept as its own function rather than importing that one, since this path isn't scoped to any particular ad. */
export async function reserveBrandCastUploadPath(
  orgId: string,
  brandId: string,
  fileName: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  await requireOrgMember(orgId);
  const storageFull = await storageFullError(orgId);
  if (storageFull) return { ok: false, error: storageFull };

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${orgId}/brand_cast/${brandId}/${Date.now()}_${safeName}`;

  return { ok: true, path };
}

/**
 * Records either a reference image (kind="image", the default) or a
 * character sheet (kind="sheet") against a brand cast member, after
 * the browser confirms the direct Storage upload succeeded. Two kinds
 * share this one function (not two near-duplicates) since the only
 * difference is which asset-id column gets written.
 */
export async function recordBrandCastUpload(
  orgId: string,
  brandId: string,
  memberId: string,
  storagePath: string,
  slot: "ref" | "sheet"
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  // Check through RLS before the service-role insert: the member must be
  // in a brand the caller can see, and the path must be the folder
  // reserveBrandCastUploadPath() handed out for that brand.
  const { data: member } = await supabase
    .from("brand_cast_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", memberId)
    .maybeSingle();
  if (!member) return { ok: false, error: "Cast member not found." };
  if (!isPathUnder(storagePath, `${orgId}/brand_cast/${brandId}/`)) {
    return { ok: false, error: "Invalid upload path." };
  }

  const service = createServiceClient();

  const { data: assetRow, error: assetError } = await service
    .from("assets")
    .insert({ org_id: orgId, brand_id: brandId, ad_id: null, kind: "image", storage_path: storagePath, source: "upload" })
    .select("id")
    .single();
  if (assetError) return { ok: false, error: assetError.message };

  const column = slot === "ref" ? "ref_asset_id" : "sheet_asset_id";
  const { error } = await supabase
    .from("brand_cast_members")
    .update({ [column]: assetRow.id })
    .eq("org_id", orgId)
    .eq("id", memberId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/cast`);
  return { ok: true };
}

/**
 * Promotes a per-ad cast_members row's existing reference/sheet
 * assets into a new reusable brand_cast_members entry — the explicit
 * "Save to library" action the editor asked for, called from the
 * per-ad Concept & Cast step rather than from this library page
 * itself. Deliberately a COPY of the asset ids, not a move: the
 * ad-scoped cast_members row keeps working exactly as it does today
 * even if the library entry is later edited or deactivated.
 */
export async function saveCastMemberToLibrary(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  castMemberId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { data: member, error: fetchError } = await supabase
    .from("cast_members")
    .select("name, description, ref_asset_id, sheet_asset_id, brand_cast_member_id")
    .eq("org_id", orgId)
    .eq("id", castMemberId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!member) return { ok: false, error: "Cast member not found." };
  if (member.brand_cast_member_id) return { ok: false, error: "Already saved to the brand library." };

  const { data: inserted, error: insertError } = await supabase
    .from("brand_cast_members")
    .insert({
      org_id: orgId,
      brand_id: brandId,
      name: member.name,
      description: member.description,
      ref_asset_id: member.ref_asset_id,
      sheet_asset_id: member.sheet_asset_id,
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  const { error: linkError } = await supabase
    .from("cast_members")
    .update({ brand_cast_member_id: inserted.id })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (linkError) return { ok: false, error: linkError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  revalidatePath(`/org/${orgId}/brands/${brandId}/cast`);
  return { ok: true };
}

/**
 * Adds an existing brand_cast_members persona directly to one ad's
 * cast — the manual "pick from library" path (editor's explicit ask:
 * reuse existing personas instead of only letting Claude auto-match
 * them during extractCast). Reuses the library entry's own reference/
 * sheet assets; approved: true since a human just deliberately chose
 * this persona for this ad, no feedback-approval loop needed.
 */
export async function addBrandCastMemberToAd(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  brandCastMemberId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const supabase = await createClient();

  const { data: libraryMember, error: fetchError } = await supabase
    .from("brand_cast_members")
    .select("name, description, ref_asset_id, sheet_asset_id")
    .eq("org_id", orgId)
    .eq("brand_id", brandId)
    .eq("id", brandCastMemberId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!libraryMember) return { ok: false, error: "Cast library entry not found." };

  const { error } = await supabase.from("cast_members").insert({
    org_id: orgId,
    ad_id: adId,
    name: libraryMember.name,
    description: libraryMember.description,
    ref_asset_id: libraryMember.ref_asset_id,
    sheet_asset_id: libraryMember.sheet_asset_id,
    brand_cast_member_id: brandCastMemberId,
    approved: true,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}

/**
 * Creates a brand-new, wholly manual cast_members row for one ad
 * (editor's explicit ask: "create a cast manually... instead of just
 * having the option of AI do it") — no Claude call, no extractCast,
 * just a direct insert the editor can then optionally attach a
 * reference image to via the existing reserveCastReferenceUploadPath/
 * recordUploadedCastReference flow (unchanged, in concepts-actions.ts).
 */
export async function createManualCastMember(
  orgId: string,
  brandId: string,
  productId: string,
  adId: string,
  name: string,
  description: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("cast_members").insert({
    org_id: orgId,
    ad_id: adId,
    name: trimmedName,
    description: description.trim() || null,
    approved: false,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${adId}`);
  return { ok: true };
}
