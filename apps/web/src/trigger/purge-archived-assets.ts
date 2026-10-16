import { schedules, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";

/**
 * Deletes files that were replaced (archived) more than 90 days ago,
 * so old regenerations don't fill an agency's storage quota forever.
 * purgeable_archived_assets (migration 62) already skips anything still
 * in use: library items, cast references and style references. The
 * file goes through the Storage API (deleting the storage.objects row
 * in SQL would leave the file itself behind), then the asset row.
 * 03:30 UTC, after distill-feedback-rules.
 */
const RETENTION_DAYS = 90;
const BATCH = 200;
const MAX_BATCHES = 25;

export const purgeArchivedAssets = schedules.task({
  id: "purge-archived-assets",
  cron: "30 3 * * *",
  maxDuration: 1800,
  run: async () => {
    const supabase = getServiceClient();
    let purged = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data, error } = await supabase.rpc("purgeable_archived_assets", {
        older_than_days: RETENTION_DAYS,
        max_rows: BATCH,
      });
      if (error) throw new Error(`purgeable_archived_assets failed: ${error.message}`);
      const rows = (data ?? []) as { asset_id: string; org_id: string; storage_path: string }[];
      if (rows.length === 0) break;

      const { error: removeError } = await supabase.storage.from("renders").remove(rows.map((r) => r.storage_path));
      if (removeError) throw new Error(`storage remove failed: ${removeError.message}`);

      const { error: deleteError } = await supabase.from("assets").delete().in("id", rows.map((r) => r.asset_id));
      if (deleteError) throw new Error(`asset delete failed: ${deleteError.message}`);

      purged += rows.length;
      if (rows.length < BATCH) break;
    }

    logger.log("purge-archived-assets: done", { purged });
    return { purged };
  },
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("purge-archived-assets: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
