import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getBrands } from "../brands/brands-data";
import { getAssignableUsers, getAssigneeIdsByBrand, type AssignableUser } from "../brands/assignment-data";

export type TaskStage = "todo" | "in_progress" | "in_review" | "done" | "delivered" | "revisions";

export type TaskColumn = {
  id: string;
  name: string;
  position: number;
  stage: TaskStage | null;
};

export type Task = {
  id: string;
  column_id: string;
  position: number;
  title: string;
  description: string | null;
  brand_id: string | null;
  assignee_id: string | null;
  ad_id: string | null;
  due_date: string | null;
  created_at: string;
};

export type BoardAd = { id: string; name: string; brand_id: string; product_id: string | null };

export type TaskRound = { id: string; round_no: number; status: "open" | "changes_requested" | "approved" };

export type BoardData = {
  columns: TaskColumn[];
  tasks: Task[];
  brands: { id: string; name: string }[];
  /** Users who can be given tasks (owner/admin view only; empty for a user). */
  people: AssignableUser[];
  /** brand_id -> user ids assigned to it, so the task form only offers valid assignees. */
  brandAssignees: Record<string, string[]>;
  /** Ads the viewer can see (RLS), for linking a task to the ad it produces. */
  ads: BoardAd[];
  /** task_id -> its latest review round. */
  latestRounds: Record<string, TaskRound>;
};

/**
 * Everything the board needs. RLS does the scoping: owners/admins get
 * every task, a user gets only tasks assigned to them (tasks_select).
 * ensure_task_columns() seeds the default columns on first open.
 */
export async function getBoardData(orgId: string, { manage }: { manage: boolean }): Promise<BoardData> {
  const supabase = await createClient();
  await supabase.rpc("ensure_task_columns", { target_org_id: orgId });

  const [columnsResult, tasksResult, brands, adsResult, roundsResult] = await Promise.all([
    supabase
      .from("task_columns")
      .select("id, name, position, stage")
      .eq("org_id", orgId)
      .eq("archived", false)
      .order("position"),
    supabase
      .from("tasks")
      .select("id, column_id, position, title, description, brand_id, assignee_id, ad_id, due_date, created_at")
      .eq("org_id", orgId)
      .eq("archived", false)
      .order("position"),
    getBrands(orgId),
    supabase
      .from("ads")
      .select("id, name, brand_id, product_id, brief, created_at")
      .eq("org_id", orgId)
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("review_rounds")
      .select("id, task_id, round_no, status")
      .eq("org_id", orgId)
      .order("round_no", { ascending: false }),
  ]);
  if (columnsResult.error) throw new Error(columnsResult.error.message);
  if (tasksResult.error) throw new Error(tasksResult.error.message);

  let people: AssignableUser[] = [];
  let brandAssignees: Record<string, string[]> = {};
  if (manage) {
    const [users, byBrand] = await Promise.all([getAssignableUsers(orgId), getAssigneeIdsByBrand(orgId)]);
    people = users;
    brandAssignees = Object.fromEntries(byBrand);
  }

  const ads: BoardAd[] = (adsResult.data ?? []).map((ad) => {
    const brief = (ad.brief ?? {}) as { hooks?: string[]; idea?: string };
    return {
      id: ad.id,
      name: ad.name || brief.hooks?.[0] || brief.idea || "Untitled ad",
      brand_id: ad.brand_id,
      product_id: ad.product_id,
    };
  });

  // Rounds come newest first, so the first one seen per task is its latest.
  const latestRounds: Record<string, TaskRound> = {};
  for (const r of roundsResult.data ?? []) {
    if (!latestRounds[r.task_id]) latestRounds[r.task_id] = { id: r.id, round_no: r.round_no, status: r.status };
  }

  return {
    columns: (columnsResult.data ?? []) as TaskColumn[],
    tasks: (tasksResult.data ?? []) as Task[],
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    people,
    brandAssignees,
    ads,
    latestRounds,
  };
}
