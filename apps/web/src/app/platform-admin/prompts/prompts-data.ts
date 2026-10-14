import "server-only";
import { PINNED_MODEL_PER_TASK, type Task } from "@/lib/claude/types";
import { createClient } from "@/lib/supabase/server";

export type PromptVersionRow = {
  id: string;
  task: string;
  version: number;
  body: string;
  active: boolean;
  created_at: string;
};

/**
 * Every task the app actually calls (the keys of PINNED_MODEL_PER_TASK,
 * the real Task union), so a new AI task shows up here automatically,
 * even before a prompt is seeded. The M4 sample task is left out.
 */
export const EDITABLE_TASKS = (Object.keys(PINNED_MODEL_PER_TASK) as Task[]).filter((t) => t !== "example_extraction");

export async function getActivePromptsByTask(): Promise<Record<string, PromptVersionRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("active", true);

  if (error) throw new Error(error.message);

  const byTask: Record<string, PromptVersionRow> = {};
  for (const row of data ?? []) {
    byTask[row.task] = row;
  }
  return byTask;
}

export async function getPromptHistory(task: string): Promise<PromptVersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("task", task)
    .order("version", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
