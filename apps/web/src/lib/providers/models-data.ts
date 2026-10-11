import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ParameterField = {
  key: string;
  label: string;
  type: "enum" | "boolean" | "integer" | "number" | "string";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  required?: boolean;
};

export type ModelOption = {
  modelId: string;
  name: string;
  provider: string;
  endpoint: string;
  promptGuide: string | null;
  parameterSchema: ParameterField[];
};

/** Every model_providers row for a given capability — the full list a picker dropdown offers. */
export async function getModelOptions(capability: "image" | "video"): Promise<ModelOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_providers")
    .select("model_id, provider, endpoint, parameter_schema, models!inner(id, name, capability, active, prompt_guide)")
    .eq("models.capability", capability)
    .eq("models.active", true);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const model = row.models as unknown as { name: string; prompt_guide: string | null };
    return {
      modelId: row.model_id,
      name: model.name,
      provider: row.provider,
      endpoint: row.endpoint,
      promptGuide: model.prompt_guide,
      parameterSchema: (row.parameter_schema ?? []) as ParameterField[],
    };
  });
}
