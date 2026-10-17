"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isOrgAdmin, requireOrgMember } from "@/lib/auth";
import { generateReferenceImage } from "@/lib/providers/generate-reference-image";
import { buildStylePreviewPrompt } from "@/lib/style-previews";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function toggleFavouriteStyle(
  orgId: string,
  styleId: string,
  favourite: boolean
): Promise<ActionResult> {
  const user = await requireOrgMember(orgId);
  const supabase = await createClient();

  if (favourite) {
    const { error } = await supabase
      .from("user_style_favourites")
      .insert({ user_id: user.id, style_id: styleId });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("user_style_favourites")
      .delete()
      .eq("user_id", user.id)
      .eq("style_id", styleId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/org/${orgId}/styles`);
  return { ok: true };
}

export type PreviewResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Generates a gallery preview image for a style and stores it publicly.
 *
 * Built-in styles (org_id null) are shared by every agency, so only a
 * platform admin may set their preview; an org's own custom styles can
 * be previewed by that org's owner or admin. Either way the generation
 * runs on THIS org's provider keys (first active brand, falling back to
 * the org key) and is recorded as spend like any other image.
 */
export async function generateStylePreview(
  orgId: string,
  styleId: string,
  subject: string,
  model: { provider: "fal" | "kie" | "higgsfield_plan"; endpoint: string }
): Promise<PreviewResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const service = createServiceClient();

  const { data: style } = await service
    .from("styles")
    .select("id, org_id, name, masterprompt")
    .eq("id", styleId)
    .maybeSingle();
  if (!style || (style.org_id !== null && style.org_id !== orgId)) return { ok: false, error: "Style not found." };

  if (style.org_id === null) {
    const { data: platformAdmin } = await supabase.rpc("is_platform_admin");
    if (!platformAdmin) return { ok: false, error: "Only a platform admin can set previews for built-in styles." };
  } else if (!(await isOrgAdmin(orgId))) {
    return { ok: false, error: "Only an owner or admin can set this style's preview." };
  }

  if (!subject.trim()) return { ok: false, error: "Describe what the preview should show." };

  const { data: brand } = await service
    .from("brands")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!brand) return { ok: false, error: "This agency needs at least one brand to pick provider keys from." };

  const image = await generateReferenceImage({
    orgId,
    brandId: brand.id,
    prompt: buildStylePreviewPrompt(style.masterprompt, subject),
    provider: model.provider,
    endpoint: model.endpoint,
    spendKind: "image:style_preview",
  });
  if (!image.ok) return { ok: false, error: image.error };

  // Copy into the public bucket so <img> tags load it without signing.
  const res = await fetch(image.signedUrl);
  if (!res.ok) return { ok: false, error: "Could not read the generated image." };
  const path = `${style.id}/${Date.now()}.png`;
  const { error: uploadError } = await service.storage
    .from("style-previews")
    .upload(path, await res.arrayBuffer(), { contentType: "image/png" });
  if (uploadError) return { ok: false, error: uploadError.message };
  const url = service.storage.from("style-previews").getPublicUrl(path).data.publicUrl;

  const { error: updateError } = await service.from("styles").update({ preview_image_url: url }).eq("id", style.id);
  if (updateError) return { ok: false, error: updateError.message };

  // The generator also filed it as a brand image; keep it out of that
  // brand's Library (archived, never deleted).
  await service.from("assets").update({ archived: true }).eq("id", image.assetId);

  revalidatePath(`/org/${orgId}/styles`);
  return { ok: true, url };
}
