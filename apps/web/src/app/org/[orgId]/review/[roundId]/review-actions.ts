"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";
import { notifySlackOfStage } from "../../board/stage-notify";

export type SceneVerdict = { sceneId: string; verdict: "approved" | "changes"; comment: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Owner/admin submits a review round. submit_review() records each
 * scene's verdict and moves the task to Revisions (any change requested)
 * or Done (all approved); the database trigger notifies the assignee.
 */
export async function submitReview(
  orgId: string,
  roundId: string,
  overallNote: string,
  verdicts: SceneVerdict[]
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);

  for (const v of verdicts) {
    if (v.verdict === "changes" && !v.comment.trim()) {
      return { ok: false, error: "Add a comment to each scene you're sending back, so the editor knows what to change." };
    }
  }

  const supabase = await createClient();
  const { data: round, error } = await supabase.rpc("submit_review", {
    target_round_id: roundId,
    review_note: overallNote,
    verdicts: verdicts.map((v) => ({ scene_id: v.sceneId, verdict: v.verdict, comment: v.comment })),
  });
  if (error) return { ok: false, error: error.message };

  if (round?.task_id) await notifySlackOfStage(orgId, round.task_id);

  revalidatePath(`/org/${orgId}/review/${roundId}`);
  revalidatePath(`/org/${orgId}/board`);
  return { ok: true };
}
