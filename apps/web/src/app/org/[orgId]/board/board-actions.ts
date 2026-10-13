"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin, requireOrgMember } from "@/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateTaskResult = { ok: true; taskId: string } | { ok: false; error: string };

export type TaskInput = {
  title: string;
  description: string;
  brandId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  columnId: string;
};

function refresh(orgId: string) {
  revalidatePath(`/org/${orgId}/board`);
  revalidatePath(`/org/${orgId}/tasks`);
}

function cleanInput(input: TaskInput) {
  const title = input.title.trim();
  if (!title) return { error: "Give the task a title." } as const;
  if (title.length > 200) return { error: "Title is too long." } as const;
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { error: "Invalid due date." } as const;
  return {
    row: {
      title,
      description: input.description.trim() || null,
      brand_id: input.brandId || null,
      assignee_id: input.assigneeId || null,
      due_date: input.dueDate || null,
      column_id: input.columnId,
    },
  } as const;
}

// Owners/admins create and edit tasks (tasks_insert/update RLS); the
// validate_task trigger checks column, brand and assignee consistency.

export async function createTask(orgId: string, input: TaskInput, position: number): Promise<CreateTaskResult> {
  const user = await requireOrgAdmin(orgId);
  const cleaned = cleanInput(input);
  if ("error" in cleaned) return { ok: false, error: cleaned.error! };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...cleaned.row, org_id: orgId, position, created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true, taskId: data.id };
}

export async function updateTask(orgId: string, taskId: string, input: TaskInput): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const cleaned = cleanInput(input);
  if ("error" in cleaned) return { ok: false, error: cleaned.error! };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(cleaned.row).eq("org_id", orgId).eq("id", taskId);
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}

export async function archiveTask(orgId: string, taskId: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ archived: true }).eq("org_id", orgId).eq("id", taskId);
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}

/** Any member may call this; move_task() lets users move only their own tasks. */
export async function moveTask(orgId: string, taskId: string, columnId: string, position: number): Promise<ActionResult> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_task", {
    target_task_id: taskId,
    target_column_id: columnId,
    target_position: position,
  });
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}

// Column management: owners and admins (task_columns RLS).

export async function addColumn(orgId: string, name: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name the column." };
  if (trimmed.length > 40) return { ok: false, error: "Column name is too long." };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("task_columns")
    .select("position")
    .eq("org_id", orgId)
    .eq("archived", false)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("task_columns")
    .insert({ org_id: orgId, name: trimmed, position: (last?.position ?? -1) + 1 });
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}

export async function renameColumn(orgId: string, columnId: string, name: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name the column." };
  if (trimmed.length > 40) return { ok: false, error: "Column name is too long." };

  const supabase = await createClient();
  const { error } = await supabase.from("task_columns").update({ name: trimmed }).eq("org_id", orgId).eq("id", columnId);
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}

/** Swaps a column with its neighbour to the left (-1) or right (+1). */
export async function shiftColumn(orgId: string, columnId: string, direction: -1 | 1): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();
  const { data: columns, error } = await supabase
    .from("task_columns")
    .select("id, position")
    .eq("org_id", orgId)
    .eq("archived", false)
    .order("position");
  if (error) return { ok: false, error: error.message };

  const list = columns ?? [];
  const i = list.findIndex((c) => c.id === columnId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };

  // Renumber everything so positions stay dense even after archived gaps.
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  for (let k = 0; k < reordered.length; k++) {
    if (reordered[k].position !== k) {
      const { error: updateError } = await supabase
        .from("task_columns")
        .update({ position: k })
        .eq("org_id", orgId)
        .eq("id", reordered[k].id);
      if (updateError) return { ok: false, error: updateError.message };
    }
  }

  refresh(orgId);
  return { ok: true };
}

export async function removeColumn(orgId: string, columnId: string): Promise<ActionResult> {
  await requireOrgAdmin(orgId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_task_column", { target_column_id: columnId });
  if (error) return { ok: false, error: error.message };

  refresh(orgId);
  return { ok: true };
}
