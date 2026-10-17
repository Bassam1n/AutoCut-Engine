import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, createPkce, registerClient } from "@/lib/providers/higgsfield-plan";
import { CALLBACK_PATH, PLAN_COOKIE, canManageBrandKeys, keysPageUrl, type PlanOAuthState } from "../shared";

/**
 * Starts "Connect Higgsfield account" (experimental): registers AutoCut
 * with Higgsfield's OAuth server for this deployment's callback URL,
 * then sends the admin to Higgsfield's login. PKCE verifier and state
 * ride in a short-lived httpOnly cookie scoped to the callback.
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
  const brandId = request.nextUrl.searchParams.get("brandId") ?? "";
  const origin = request.nextUrl.origin;
  if (!orgId || !brandId || !(await canManageBrandKeys(orgId, brandId))) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const redirectUri = `${origin}${CALLBACK_PATH}`;
  let clientId: string;
  try {
    clientId = await registerClient(redirectUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Higgsfield.";
    return NextResponse.redirect(keysPageUrl(origin, orgId, brandId, { higgsfield_plan: "error", message }));
  }

  const { verifier, challenge } = await createPkce();
  const state = crypto.randomUUID();
  const cookie: PlanOAuthState = { state, verifier, clientId, orgId, brandId, redirectUri };

  const response = NextResponse.redirect(authorizeUrl({ clientId, redirectUri, state, codeChallenge: challenge }));
  response.cookies.set(PLAN_COOKIE, JSON.stringify(cookie), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: CALLBACK_PATH,
    maxAge: 600,
  });
  return response;
}
