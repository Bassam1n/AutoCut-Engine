import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Task } from "./types";

export type PromptVersion = {
  version: number;
  body: string;
};

/**
 * Reads the active prompt body for a task from prompt_versions (spec
 * §4: "Prompts are data. Prompts live in prompt_versions. Every LLM
 * and provider call records model, prompt version and input hash.")
 * Uses the service-role client — prompt_versions is readable by any
 * authenticated user via RLS, but llm.call() always runs server-side
 * (it needs the org's Vault-stored key), so there's no reason to carry
 * a user session through this read.
 */
export async function getActivePrompt(task: Task): Promise<PromptVersion> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("version, body")
    .eq("task", task)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`no active prompt_versions row for task "${task}"`);

  return data;
}
