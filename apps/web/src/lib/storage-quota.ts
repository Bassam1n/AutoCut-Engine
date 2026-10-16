import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Upload paths (product refs, feedback images, cast references) are
 * reserved before the browser uploads straight to Storage, so the quota
 * check that claim_paid_media_job does for generations happens here
 * for uploads. Returns a message when the agency's storage is full.
 */
export async function storageFullError(orgId: string): Promise<string | null> {
  const service = createServiceClient();
  const { data: org } = await service.from("orgs").select("storage_quota_gb").eq("id", orgId).maybeSingle();
  const quota = org?.storage_quota_gb as number | null | undefined;
  if (quota === null || quota === undefined) return null;
  const { data: used, error } = await service.rpc("org_storage_bytes", { target_org_id: orgId });
  if (error) return null;
  if (Number(used) < quota * 1e9) return null;
  return `Your agency has used its ${quota} GB of storage. Your owner can permanently delete archived ads to free space, or move to a bigger plan.`;
}
