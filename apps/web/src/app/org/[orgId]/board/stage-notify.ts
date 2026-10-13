import "server-only";
import { createClient } from "@/lib/supabase/server";
import { appUrl, postToSlack } from "@/lib/slack";

/**
 * Slack side of a task's stage change. The in-app notifications are
 * written by the database trigger (migration 57); this posts the same
 * events to the org's Slack channel, if connected. Call after any action
 * that may have moved a task between columns.
 */
export async function notifySlackOfStage(orgId: string, taskId: string): Promise<void> {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("title, column_id, task_columns(stage)")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return;

  const stage = (task.task_columns as unknown as { stage: string | null } | null)?.stage;
  if (stage !== "in_review" && stage !== "revisions" && stage !== "done") return;

  const { data: round } = await supabase
    .from("review_rounds")
    .select("id, round_no, status")
    .eq("task_id", taskId)
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  let text: string | null = null;
  if (stage === "in_review" && round?.status === "open") {
    const roundLabel = round.round_no > 1 ? ` (revision round ${round.round_no})` : "";
    text = `:mag: *${task.title}* is ready for review${roundLabel}. <${appUrl(`/org/${orgId}/review/${round.id}`)}|Open review>`;
  } else if (stage === "revisions" && round?.status === "changes_requested") {
    text = `:pencil2: Changes requested on *${task.title}* (round ${round.round_no}).`;
  } else if (stage === "done" && round?.status === "approved") {
    text = `:white_check_mark: *${task.title}* was approved.`;
  }

  if (text) await postToSlack(orgId, text);
}
