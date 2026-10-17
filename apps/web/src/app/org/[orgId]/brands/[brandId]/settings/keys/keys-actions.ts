"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/auth";
import { verifyProviderKey } from "@/app/org/[orgId]/settings/keys/verify-provider-key";
import type { ApiKeyProvider } from "@/app/org/[orgId]/settings/keys/keys-data";
import { createServiceClient } from "@/lib/supabase/service";
import {
  HiggsfieldPlanError,
  callMcpTool,
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

export type PlanTestResult =
  | {
      ok: true;
      stage: "preflight_failed" | "generated" | "submit_failed" | "not_finished";
      balanceBefore: string;
      cost: string;
      jobId: string | null;
      imageUrl: string | null;
      balanceAfter: string | null;
      detail: string | null;
    }
  | { ok: false; error: string };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const IMAGE_URL_RE = /https:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>)]*)?/i;

function logChunks(label: string, text: string) {
  for (let i = 0; i < text.length; i += 1500) {
    console.log(`higgsfield_plan: ${label} [${i / 1500 + 1}/${Math.ceil(text.length / 1500)}]`, text.slice(i, i + 1500));
  }
}

/**
 * Experimental, user-confirmed test of plan-credit generation: logs
 * generate_image's full input schema, reads the balance, runs a FREE
 * cost preflight (get_cost: true) and only if that succeeds generates
 * ONE small image on the account's plan, then reads the balance again.
 * Tokens are never logged.
 */
export async function testHiggsfieldPlanImage(orgId: string, brandId: string): Promise<PlanTestResult> {
  await requireOrgAdmin(orgId);
  const service = createServiceClient();
  const { data: raw, error } = await service.rpc("get_brand_secret_value", {
    target_org_id: orgId,
    target_brand_id: brandId,
    target_provider: "higgsfield_plan",
  });
  if (error || !raw) return { ok: false, error: "Connect the Higgsfield account first." };

  try {
    let tokens = JSON.parse(raw) as HiggsfieldPlanTokens;
    if (needsRefresh(tokens)) {
      tokens = await refreshTokens(tokens);
      await (await createClient()).rpc("save_brand_secret", {
        target_org_id: orgId,
        target_brand_id: brandId,
        target_provider: "higgsfield_plan",
        secret_value: JSON.stringify(tokens),
      });
    }
    const token = tokens.accessToken;

    const tools = await listMcpTools(token);
    const generateImage = tools.find((t) => t.name === "generate_image");
    if (generateImage) logChunks("full schema generate_image", JSON.stringify(generateImage.inputSchema));

    const before = await callMcpTool(token, "balance", {});
    logChunks("balance before", before.text);

    const args = {
      model: "soul_2",
      prompt: "A white ceramic coffee mug on a wooden table beside a sunlit window, soft natural light, product photo.",
      aspect_ratio: "1:1",
      count: 1,
    };
    const preflight = await callMcpTool(token, "generate_image", { ...args, get_cost: true });
    logChunks(`preflight isError=${preflight.isError}`, preflight.text);
    const base = { balanceBefore: before.text.slice(0, 400), cost: preflight.text.slice(0, 400) };
    if (preflight.isError) {
      return { ok: true, stage: "preflight_failed", ...base, jobId: null, imageUrl: null, balanceAfter: null, detail: preflight.text.slice(0, 600) };
    }

    const submit = await callMcpTool(token, "generate_image", args);
    logChunks(`submit isError=${submit.isError}`, submit.text);
    const jobId = submit.text.match(UUID_RE)?.[0] ?? null;
    if (submit.isError || !jobId) {
      return { ok: true, stage: "submit_failed", ...base, jobId, imageUrl: null, balanceAfter: null, detail: submit.text.slice(0, 600) };
    }

    let imageUrl: string | null = null;
    let lastStatus = "";
    for (let attempt = 0; attempt < 4 && !imageUrl; attempt++) {
      const status = await callMcpTool(token, "job_status", { jobId, sync: true });
      lastStatus = status.text;
      logChunks(`job_status attempt ${attempt + 1}`, status.text);
      imageUrl = status.text.match(IMAGE_URL_RE)?.[0] ?? null;
      if (/"status"\s*:\s*"(failed|nsfw|canceled|cancelled)"/i.test(status.text)) break;
    }

    const after = await callMcpTool(token, "balance", {});
    logChunks("balance after", after.text);

    return {
      ok: true,
      stage: imageUrl ? "generated" : "not_finished",
      ...base,
      jobId,
      imageUrl,
      balanceAfter: after.text.slice(0, 400),
      detail: imageUrl ? null : lastStatus.slice(0, 600),
    };
  } catch (err) {
    const message = err instanceof HiggsfieldPlanError ? `${err.message}${err.detail ? ` (${err.detail})` : ""}` : "Could not reach Higgsfield.";
    return { ok: false, error: message };
  }
}
