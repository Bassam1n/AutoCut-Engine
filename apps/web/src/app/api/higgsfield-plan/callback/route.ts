import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, listMcpTools, HiggsfieldPlanError } from "@/lib/providers/higgsfield-plan";
import { CALLBACK_PATH, PLAN_COOKIE, canManageBrandKeys, keysPageUrl, type PlanOAuthState } from "../shared";

/**
 * Higgsfield's OAuth redirect lands here: checks state, trades the code
 * for tokens, stores them in Vault as this brand's "higgsfield_plan"
 * secret, then proves the login works by listing Higgsfield's MCP
 * tools (generate_image must be among them) before marking it verified.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;

  let saved: PlanOAuthState | null = null;
  try {
    saved = JSON.parse(request.cookies.get(PLAN_COOKIE)?.value ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || !params.get("state") || params.get("state") !== saved.state) {
    return NextResponse.redirect(new URL("/", origin));
  }
  const { orgId, brandId } = saved;
  const back = (query: Record<string, string>) => {
    const res = NextResponse.redirect(keysPageUrl(origin, orgId, brandId, query));
    res.cookies.set(PLAN_COOKIE, "", { path: CALLBACK_PATH, maxAge: 0 });
    return res;
  };

  if (!(await canManageBrandKeys(orgId, brandId))) return back({ higgsfield_plan: "error", message: "Not allowed." });

  const oauthError = params.get("error");
  if (oauthError) {
    const description = params.get("error_description");
    console.warn("higgsfield_plan: authorize refused", { oauthError, description });
    return back({ higgsfield_plan: "error", message: `Higgsfield refused the sign-in: ${description ?? oauthError}` });
  }
  const code = params.get("code");
  if (!code) return back({ higgsfield_plan: "error", message: "Higgsfield returned no authorization code." });

  try {
    const tokens = await exchangeCode({
      clientId: saved.clientId,
      redirectUri: saved.redirectUri,
      code,
      codeVerifier: saved.verifier,
    });

    const supabase = await createClient();
    const { error: saveError } = await supabase.rpc("save_brand_secret", {
      target_org_id: orgId,
      target_brand_id: brandId,
      target_provider: "higgsfield_plan",
      secret_value: JSON.stringify(tokens),
    });
    if (saveError) return back({ higgsfield_plan: "error", message: saveError.message });

    let tools: string[] = [];
    let toolsError: string | null = null;
    try {
      tools = (await listMcpTools(tokens.accessToken)).map((t) => t.name);
    } catch (err) {
      toolsError = err instanceof HiggsfieldPlanError ? `${err.message} ${err.detail ?? ""}`.trim() : "Tool listing failed.";
    }
    console.log("higgsfield_plan: connected", { orgId, brandId, toolCount: tools.length, toolsError });

    if (toolsError || !tools.includes("generate_image")) {
      return back({ higgsfield_plan: "error", message: `Signed in, but Higgsfield's generation tools didn't load. ${toolsError ?? ""}`.trim() });
    }
    await supabase.rpc("mark_brand_secret_verified", {
      target_org_id: orgId,
      target_brand_id: brandId,
      target_provider: "higgsfield_plan",
    });
    return back({ higgsfield_plan: "connected" });
  } catch (err) {
    const message =
      err instanceof HiggsfieldPlanError ? `${err.message}${err.detail ? ` (${err.detail})` : ""}` : "Connecting Higgsfield failed.";
    console.warn("higgsfield_plan: callback failed", { message });
    return back({ higgsfield_plan: "error", message });
  }
}
