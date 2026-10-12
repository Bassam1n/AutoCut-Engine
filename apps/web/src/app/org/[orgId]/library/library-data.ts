import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type LibraryAssetKind = "image" | "video";

export type LibraryItem = {
  id: string;
  org_id: string;
  brand_id: string | null;
  asset_id: string;
  name: string | null;
  tags: string[];
  favorite: boolean;
  created_at: string;
  updated_at: string;
  // Joined from assets — read-only here, never written through library_items.
  asset_kind: string;
  asset_storage_path: string;
};

/**
 * Every library_items row for this org, newest first, with the
 * underlying asset's kind/storage_path embedded (one PostgREST
 * embedded join, same pattern ads-data.ts's getAllOrgAds() uses for
 * brands!inner(name)/products!inner(name)). library_items.asset_id is
 * not-null (spec §4), so `!inner` is safe — there's always exactly
 * one matching asset row, confirmed by migration 10's foreign key.
 *
 * Only images and videos are library-save targets (spec §5.9: "Save
 * any image or video to the library") — other asset kinds (vo,
 * caption, overlay, final, feedback, last_frame, broll) are filtered
 * out defensively even though saveToLibrary() never lets one in,
 * since this is the single source of truth the Library page renders
 * from and a stray row from any future direct-insert path shouldn't
 * silently show up as a broken thumbnail.
 */
export async function getLibraryItems(orgId: string): Promise<LibraryItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("library_items")
    .select("*, assets!inner(kind, storage_path)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const { assets, ...item } = row as LibraryItem & { assets: { kind: string; storage_path: string } };
      return { ...item, asset_kind: assets.kind, asset_storage_path: assets.storage_path };
    })
    .filter((item) => item.asset_kind === "image" || item.asset_kind === "video");
}

/** Signed URLs for the `renders` bucket — library items point at existing scene/cast/feedback assets, all stored there, never duplicated into the separate `library` bucket (spec: a library save re-points at the SAME asset, it never copies the file). */
export async function getLibrarySignedUrls(storagePaths: string[]): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const service = createServiceClient();
  const { data, error } = await service.storage.from("renders").createSignedUrls(storagePaths, 3600);
  if (error) throw new Error(error.message);

  const result: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) result[entry.path] = entry.signedUrl;
  }
  return result;
}

export type LibraryCastMemberOption = {
  ad_id: string;
  ad_name: string | null;
  cast_member_id: string;
  cast_member_name: string;
};

/**
 * Every cast_members row across every ad in the org, for the "set as
 * character reference" picker's cast-member dropdown — spec §5.9:
 * "set it as a character or style reference," and cast_members has no
 * dedicated per-org listing anywhere yet (concepts-data.ts's
 * getCastMembers() is scoped to one ad, which is the right scope for
 * the Concept & cast step itself, but the Library needs to offer every
 * ad's cast across the whole org since a saved library image can be
 * assigned to any ad's character).
 */
export async function getAllOrgCastMembers(orgId: string): Promise<LibraryCastMemberOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cast_members")
    .select("id, ad_id, name, ads!inner(name)")
    .eq("org_id", orgId)
    .order("name");

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const r = row as unknown as { id: string; ad_id: string; name: string; ads: { name: string | null } };
    return {
      ad_id: r.ad_id,
      ad_name: r.ads.name,
      cast_member_id: r.id,
      cast_member_name: r.name,
    };
  });
}
