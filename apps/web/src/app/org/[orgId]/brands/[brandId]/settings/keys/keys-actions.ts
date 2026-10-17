"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";
import { verifyProviderKey } from "@/app/org/[orgId]/settings/keys/verify-provider-key";
import type { ApiKeyProvider } from "@/app/org/[orgId]/settings/keys/keys-data";
import { createServiceClient } from "@/lib/supabase/service";
import {
  HiggsfieldPlanError,
  listMcpTools,
  needsRefresh,
  refreshTokens,
  type HiggsfieldPlanTokens,
} from "@/lib/providers/higgsfield-plan";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Brand-scoped twin of saveProviderKey (org-level settings/keys). Same
 * verify-before-save contract: the raw key passes through this Server
 * Action only, never logged/returned/stored anywhere but Vault (via
 * save_brand_secret's vault.create_secret/update_secret).
 *
 * requireOrgAdmin, not a brand-level check — this app has no
 * brand-scoped role, only org_members' org-wide owner/admin, and a
 * brand always belongs to exactly one org (save_brand_secret's own RPC
 * re-verifies brand_id belongs to target_org_id server-side regardless).
 */
export async function saveBrandProviderKey(
  orgId: string,
  brandId: string,
  provider: ApiKeyProvider,
  key: string
): Promise<ActionResult> {
  await requireOrgAdmin(orgId);

  const trimmed = key.trim();
  if (trimmed.length < 4) {
    return { ok: false, error: "That doesn't look like a valid key." };
  }

  const verification = await verifyProviderKey(provider, trimmed);
  if (!verification.ok) {
    return { ok: false, error: verification.error };
  }

  const supabase = await createClient();

  const { error: saveError } = await supabase.rpc("save_brand_secret", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: provider,
    secret_value: trimmed,
  });
  if (saveError) return { ok: false, error: saveError.message };

  const { error: verifyError } = await supabase.rpc("mark_brand_secret_verified", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: provider,
  });
  if (verifyError) return { ok: false, error: verifyError.message };

  revalidatePath(`/org/${orgId}/brands/${brandId}/settings/keys`);
  return { ok: true };
}

export type InspectPlanResult =
  | { ok: true; toolCount: number; generationTools: string[] }
  | { ok: false; error: string };

/** Tools whose input formats the plan-credit generation path will be built on. */
const PLAN_TOOLS_OF_INTEREST =
  /^(generate_image|generate_video|job_status|jobs_wait|job_display|models_explore|media_import_url|media_upload|media_confirm|show_generations|use_higgsfield)$|balance|credit|account|plan|wallet|cost/i;

/**
 * Experimental, free: reads the brand's Higgsfield account login,
 * refreshes it if needed, and logs the full MCP tool list plus the
 * input schemas of the generation-related tools (never the tokens), so
 * plan-credit generation can be built against Higgsfield's real tool
 * formats. Nothing is generated.
 */
export async function inspectHiggsfieldPlan(orgId: string, brandId: string): Promise<InspectPlanResult> {
  await requireOrgAdmin(orgId);
  const service = createServiceClient();
  const { data: raw, error } = await service.rpc("get_brand_secret_value", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: "higgsfield_plan",
  });
  if (error || !raw) return { ok: false, error: "Connect the Higgsfield account first." };

  let tokens: HiggsfieldPlanTokens;
  try {
    tokens = JSON.parse(raw) as HiggsfieldPlanTokens;
    if (needsRefresh(tokens)) {
      tokens = await refreshTokens(tokens);
      // save_brand_secret checks the caller is an org admin, so it runs as the user.
      await (await createClient()).rpc("save_brand_secret", {
        target_org_id: orgId,
        target_brand_id: brandId,
        target_provider: "higgsfield_plan",
        secret_value: JSON.stringify(tokens),
      });
    }
    const tools = await listMcpTools(tokens.accessToken);
    const names = tools.map((t) => t.name);
    for (let i = 0; i < names.length; i += 40) {
      console.log(`higgsfield_plan: tools ${i + 1}-${Math.min(i + 40, names.length)} of ${names.length}`, names.slice(i, i + 40).join(", "));
    }
    const interesting = tools.filter((t) => PLAN_TOOLS_OF_INTEREST.test(t.name));
    for (const tool of interesting) {
      console.log(
        `higgsfield_plan: schema ${tool.name}`,
        JSON.stringify({ description: tool.description, inputSchema: tool.inputSchema }).slice(0, 6000)
      );
    }
    return { ok: true, toolCount: tools.length, generationTools: interesting.map((t) => t.name) };
  } catch (err) {
    const message = err instanceof HiggsfieldPlanError ? `${err.message}${err.detail ? ` (${err.detail})` : ""}` : "Could not reach Higgsfield.";
    return { ok: false, error: message };
  }
}
