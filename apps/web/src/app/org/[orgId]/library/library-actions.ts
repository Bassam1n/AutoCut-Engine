"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";
import { llmCall } from "@/lib/claude/call";
import { LlmCallError } from "@/lib/claude/types";
import { GenerateLibraryTagsSchema } from "@/lib/claude/schemas/generate-library-tags";
import { getLibraryItems, getLibrarySignedUrls } from "./library-data";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type MiniLibraryImage = {
  asset_id: string;
  name: string | null;
  url: string | undefined;
};

/**
 * Image-only, signed-URL-ready listing for the mini-library browser
 * panel opened from inside Scene images (spec §5.9: "Drag a library
 * item into a scene"). A full page navigation to /library and back
 * would lose the scene cards the editor is dragging onto, so this
 * is a lightweight client-callable read, not a page — see
 * scene-images-step.tsx's LibraryPanel for the caller.
 */
export async function listLibraryImagesForPanel(orgId: string): Promise<MiniLibraryImage[]> {
  await requireOrgMember(orgId);
  const items = (await getLibraryItems(orgId)).filter((item) => item.asset_kind === "image");
  const urls = await getLibrarySignedUrls(items.map((item) => item.asset_storage_path));
  return items.map((item) => ({
    asset_id: item.asset_id,
    name: item.name,
    url: urls[item.asset_storage_path],
  }));
}

/**
 * Org-owned (not platform-seeded) styles, for the "set as style
 * reference" picker — only these can ever be updated (styles_update,
 * migration 7: org_id is not null and matches). Listing only the
 * editable subset here rather than every visible style avoids
 * offering a choice that would just fail against setStyleReference().
 */
export async function listOrgEditableStyles(orgId: string): Promise<{ id: string; name: string }[]> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("styles")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Saves an existing asset to the library (spec §5.9: "Save any image
 * or video to the library"). Inserts a library_items row pointing at
 * the asset's id — never duplicates the asset or its storage object,
 * per the task's explicit instruction and the spec's own storage rule
 * (§4: copy into our own storage once, then reference only that copy
 * — an asset already generated through generateSceneImages/
 * generateSceneVideo is already that one copy).
 *
 * AI naming/tagging (spec: "AI names and tags images") runs
 * synchronously here, image-only, BEFORE the insert, so the row is
 * created with real values on the first read rather than a lazy
 * backfill. A failed tagging call (LlmCallError — bad key, spend
 * limit, validation) does not block the save: the item is still
 * saved with name=null, exactly how an editor can rename it manually
 * at any time anyway (library_items.name is nullable by design,
 * migration 10).
 */
export async function saveToLibrary(
  orgId: string,
  assetId: string,
  brandId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const service = createServiceClient();
  const { data: asset, error: assetError } = await service
    .from("assets")
    .select("id, org_id, kind, storage_path")
    .eq("id", assetId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (assetError) return { ok: false, error: assetError.message };
  if (!asset) return { ok: false, error: "Asset not found." };
  if (asset.kind !== "image" && asset.kind !== "video") {
    return { ok: false, error: "Only images and videos can be saved to the library." };
  }

  let name: string | null = null;
  let tags: string[] = [];
  if (asset.kind === "image") {
    const { data: signed } = await service.storage.from("renders").createSignedUrl(asset.storage_path, 300);
    if (signed?.signedUrl) {
      try {
        const result = await llmCall({
          task: "generate_library_tags",
          schema: GenerateLibraryTagsSchema,
          orgId,
          imageUrls: [signed.signedUrl],
          input: {},
        });
        name = result.output.name;
        tags = result.output.tags;
      } catch (err) {
        // Naming/tagging is a nice-to-have, not a gate on saving —
        // same "don't block on a non-essential LLM call" posture
        // ensureProductSpec() takes for a failed vision call.
        if (!(err instanceof LlmCallError)) throw err;
      }
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("library_items").insert({
    org_id: orgId,
    brand_id: brandId,
    asset_id: assetId,
    name,
    tags,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/library`);
  return { ok: true };
}

export async function renameLibraryItem(orgId: string, itemId: string, name: string): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("library_items")
    .update({ name: name.trim() || null })
    .eq("org_id", orgId)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/library`);
  return { ok: true };
}

export async function setLibraryItemFavorite(
  orgId: string,
  itemId: string,
  favorite: boolean
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("library_items")
    .update({ favorite })
    .eq("org_id", orgId)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/library`);
  return { ok: true };
}

export async function assignLibraryItemBrand(
  orgId: string,
  itemId: string,
  brandId: string | null
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("library_items")
    .update({ brand_id: brandId })
    .eq("org_id", orgId)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/library`);
  return { ok: true };
}

export async function deleteLibraryItem(orgId: string, itemId: string): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase.from("library_items").delete().eq("org_id", orgId).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${orgId}/library`);
  return { ok: true };
}

/**
 * Spec §5.9: "set it as a character... reference." cast_members has a
 * clear existing target (migration 8): ref_asset_id (single reference
 * image) or sheet_asset_id (character reference sheet) — both already
 * read by concepts-actions.ts's generation flow. The editor picks
 * which cast_member and which of the two fields.
 */
export async function setCharacterReference(
  orgId: string,
  castMemberId: string,
  field: "ref_asset_id" | "sheet_asset_id",
  assetId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("cast_members")
    .update({ [field]: assetId })
    .eq("org_id", orgId)
    .eq("id", castMemberId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Spec §5.9: "set it as... a style reference." Writes
 * styles.reference_asset_id (migration 45) — see
 * scene-images-actions.ts's assembleSceneReferences() for the real
 * downstream tier that now reads it. Uses the regular (RLS-bound)
 * client rather than the service client deliberately: styles_update
 * (migration 7) only allows an org to update its OWN styles (org_id
 * not null and matches), never a platform-seeded style — the same
 * rule that already governs every other styles column (name,
 * masterprompt, etc.) should govern this one too, so a seed style
 * correctly cannot be assigned a reference this way, and that
 * rejection is enforced by Postgres, not re-implemented here.
 */
export async function setStyleReference(
  orgId: string,
  styleId: string,
  assetId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("styles")
    .update({ reference_asset_id: assetId })
    .eq("id", styleId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "Could not update that style — it may be a shared platform style, which can't be edited by your org.",
    };
  }

  return { ok: true };
}

/**
 * Spec §5.9: "Drag a library item into a scene." Dropping a library
 * image onto a scene creates a NEW versioned assets row for that
 * scene (kind='image', same nextVersion pattern generateSceneImages
 * uses) pointing at the SAME storage_path as the library item's
 * underlying asset — the file is reused, never re-uploaded or
 * duplicated in Storage, exactly like saveToLibrary() never
 * duplicates the asset going INTO the library.
 *
 * Chosen over re-scoping the existing asset's own scene_id/ad_id in
 * place: a library item's underlying asset may already be scoped to
 * a DIFFERENT ad/scene (most library items come from an existing
 * scene's generated image), and that origin asset must keep
 * belonging to its original scene's version history — moving it would
 * silently break that scene's own image strip. Versioning a new row
 * is also exactly how every other "new image for this scene" path in
 * this app already works (generateSceneImages's nextVersion), so a
 * dropped library image behaves identically to a freshly generated
 * one: it becomes the new current version, and any existing video
 * for that scene is archived the same way a regeneration archives it
 * (spec §5.8), since the scene's image just changed under it.
 */
export async function addLibraryItemToScene(
  orgId: string,
  adId: string,
  sceneId: string,
  assetId: string
): Promise<ActionResult> {
  await requireOrgMember(orgId);

  const service = createServiceClient();
  const { data: sourceAsset, error: sourceError } = await service
    .from("assets")
    .select("storage_path, kind")
    .eq("id", assetId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (sourceError) return { ok: false, error: sourceError.message };
  if (!sourceAsset) return { ok: false, error: "Library asset not found." };
  if (sourceAsset.kind !== "image") {
    return { ok: false, error: "Only images can be dragged into a scene for now." };
  }

  const { data: existingVersions } = await service
    .from("assets")
    .select("version")
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "image")
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existingVersions?.[0]?.version ?? 0) + 1;

  const { error: insertError } = await service.from("assets").insert({
    org_id: orgId,
    ad_id: adId,
    scene_id: sceneId,
    kind: "image",
    version: nextVersion,
    storage_path: sourceAsset.storage_path,
    source: "library",
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Same side effect generateSceneImages() has: a new current image
  // for this scene makes any existing video stale.
  await service
    .from("assets")
    .update({ archived: true })
    .eq("org_id", orgId)
    .eq("scene_id", sceneId)
    .eq("kind", "video")
    .eq("archived", false);

  return { ok: true };
}
