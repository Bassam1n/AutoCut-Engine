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
  due_date: string | null;
  created_at: string;
};

export type BoardData = {
  columns: TaskColumn[];
  tasks: Task[];
  brands: { id: string; name: string }[];
  /** Users who can be given tasks (owner/admin view only; empty for a user). */
  people: AssignableUser[];
  /** brand_id -> user ids assigned to it, so the task form only offers valid assignees. */
  brandAssignees: Record<string, string[]>;
};

/**
 * Everything the board needs. RLS does the scoping: owners/admins get
 * every task, a user gets only tasks assigned to them (tasks_select).
 * ensure_task_columns() seeds the default columns on first open.
 */
export async function getBoardData(orgId: string, { manage }: { manage: boolean }): Promise<BoardData> {
  const supabase = await createClient();
  await supabase.rpc("ensure_task_columns", { target_org_id: orgId });

  const [columnsResult, tasksResult, brands] = await Promise.all([
    supabase
      .from("task_columns")
      .select("id, name, position, stage")
      .eq("org_id", orgId)
      .eq("archived", false)
      .order("position"),
    supabase
      .from("tasks")
      .select("id, column_id, position, title, description, brand_id, assignee_id, due_date, created_at")
      .eq("org_id", orgId)
      .eq("archived", false)
      .order("position"),
    getBrands(orgId),
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

  return {
    columns: (columnsResult.data ?? []) as TaskColumn[],
    tasks: (tasksResult.data ?? []) as Task[],
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    people,
    brandAssignees,
  };
}
