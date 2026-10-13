import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ActiveRevision = {
  roundNo: number;
  overallNote: string | null;
  /** scene_id -> what the reviewer asked to change. */
  notes: Record<string, string>;
};

/**
 * The reviewer's requested changes for this ad, if its latest review
 * round came back "changes requested" (migration 57). Once the editor
 * resubmits, a newer open round becomes the latest and this returns
 * null. RLS shows rounds to owners/admins and the task's assignee.
 */
export async function getActiveRevision(orgId: string, adId: string): Promise<ActiveRevision | null> {
  const supabase = await createClient();
  const { data: round } = await supabase
    .from("review_rounds")
    .select("id, round_no, status, overall_note, scene_reviews(scene_id, verdict, comment)")
    .eq("org_id", orgId)
    .eq("ad_id", adId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!round || round.status !== "changes_requested") return null;

  const reviews = (round.scene_reviews ?? []) as { scene_id: string; verdict: string; comment: string | null }[];
  return {
    roundNo: round.round_no,
    overallNote: round.overall_note,
    notes: Object.fromEntries(
      reviews.filter((r) => r.verdict === "changes").map((r) => [r.scene_id, r.comment ?? "Changes requested"])
    ),
  };
}
