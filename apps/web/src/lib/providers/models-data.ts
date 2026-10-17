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
  isDefault: boolean;
};

/**
 * Every model_providers row for a given capability — the full list a
 * picker dropdown offers, with the org-wide preferred default
 * (models.is_default) sorted first so every picker's own "pick the
 * first option" fallback lands on a deliberate choice rather than
 * whatever happened to be seeded/returned first.
 */
export async function getModelOptions(capability: "image" | "video"): Promise<ModelOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("model_providers")
    .select(
      "model_id, provider, endpoint, parameter_schema, models!inner(id, name, capability, active, prompt_guide, is_default)"
    )
    .eq("models.capability", capability)
    .eq("models.active", true);

  if (error) throw new Error(error.message);

  const options = (data ?? []).map((row) => {
    const model = row.models as unknown as { name: string; prompt_guide: string | null; is_default: boolean };
    return {
      modelId: row.model_id,
      name: model.name,
      provider: row.provider,
      endpoint: row.endpoint,
      promptGuide: model.prompt_guide,
      parameterSchema: (row.parameter_schema ?? []) as ParameterField[],
      isDefault: model.is_default,
    };
  });

  return options.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export type TargetModel = { name: string; provider: string; prompt_guide: string };

/**
 * The chosen model's registry prompt guide, handed to the prompt-writing
 * Claude calls (write_image_prompt v5+, write_video_prompt v3+) as
 * `target_model`, so the prompt is written for that model's strengths
 * and limits. Null when the model has no guide or isn't registered.
 */
export async function getTargetModel(
  model: { provider: string; endpoint: string } | null | undefined
): Promise<TargetModel | null> {
  if (!model) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("model_providers")
    .select("provider, models!inner(name, prompt_guide)")
    .eq("provider", model.provider)
    .eq("endpoint", model.endpoint)
    .limit(1)
    .maybeSingle();
  const row = data?.models as unknown as { name: string; prompt_guide: string | null } | undefined;
  if (!row?.prompt_guide) return null;
  return { name: row.name, provider: model.provider, prompt_guide: row.prompt_guide };
}
