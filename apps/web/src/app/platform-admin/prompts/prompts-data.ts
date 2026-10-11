import "server-only";
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
 * Hardcoded against the real Task union (apps/web/src/lib/claude/types.ts)
 * rather than derived from distinct prompt_versions.task values, so a
 * task with no prompt seeded yet still shows up as an empty editable
 * slot instead of silently not existing on this page.
 */
export const EDITABLE_TASKS = [
  "example_extraction",
  "generate_ad_scripts",
  "generate_scene_plan",
  "generate_concepts",
  "extract_cast",
  "generate_scene_visuals",
] as const;

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
