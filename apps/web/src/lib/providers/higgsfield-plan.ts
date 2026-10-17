// No "server-only" guard, same as the other provider modules: pure
// fetch logic, tokens are always passed in by the caller.

/**
 * EXPERIMENTAL: "Connect Higgsfield account", so generation can spend a
 * client's higgsfield.ai plan credits instead of a separate API balance.
 * Plan credits are only reachable through Higgsfield's MCP server, which
 * authenticates with OAuth 2.1 (authorization code + PKCE, dynamic
 * client registration), per its metadata at
 * mcp.higgsfield.ai/.well-known/oauth-authorization-server
 * (read 2026-10-17). Whether Higgsfield's login accepts a third-party
 * web app is exactly what this is here to test; nothing generates
 * through it yet.
 */

export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";
const OAUTH_BASE = "https://mcp.higgsfield.ai/oauth2";
const SCOPE = "openid email offline_access";

export type HiggsfieldPlanTokens = {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number | null;
};

export class HiggsfieldPlanError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = "HiggsfieldPlanError";
  }
}

/** Registers AutoCut for this redirect URI (RFC 7591) and returns the client id. */
export async function registerClient(redirectUri: string): Promise<string> {
  const res = await fetch(`${OAUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "AutoCut",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = (await res.json().catch(() => null)) as { client_id?: string } | null;
  if (!res.ok || !body?.client_id) {
    throw new HiggsfieldPlanError(`Higgsfield client registration failed (HTTP ${res.status}).`);
  }
  return body.client_id;
}

export function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(`${OAUTH_BASE}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(params: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<HiggsfieldPlanTokens> {
  return tokenRequest(params.clientId, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshTokens(tokens: HiggsfieldPlanTokens): Promise<HiggsfieldPlanTokens> {
  if (!tokens.refreshToken) throw new HiggsfieldPlanError("The Higgsfield login expired. Connect the account again.");
  const next = await tokenRequest(tokens.clientId, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
}

async function tokenRequest(clientId: string, fields: Record<string, string>): Promise<HiggsfieldPlanTokens> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...fields, client_id: clientId }).toString(),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!res.ok || !body?.access_token) {
    throw new HiggsfieldPlanError(
      `Higgsfield token request failed (HTTP ${res.status}).`,
      body?.error_description ?? body?.error
    );
  }
  return {
    clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
  };
}

/** PKCE (RFC 7636) verifier and S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type McpTool = { name: string; description?: string };

/**
 * Minimal MCP (streamable HTTP) client: initialize, then tools/list.
 * Used to prove the stored login actually reaches Higgsfield's tools.
 */
export async function listMcpTools(accessToken: string): Promise<McpTool[]> {
  const init = await mcpRequest(accessToken, null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "AutoCut", version: "1.0.0" },
    },
  });
  const sessionId = init.sessionId;
  await mcpRequest(accessToken, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await mcpRequest(accessToken, sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list.result as { tools?: McpTool[] } | undefined)?.tools ?? [];
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

async function mcpRequest(
  accessToken: string,
  sessionId: string | null,
  message: Record<string, unknown>
): Promise<{ sessionId: string | null; result?: unknown }> {
  const res = await fetch(HIGGSFIELD_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
  const nextSession = res.headers.get("mcp-session-id") ?? sessionId;
  if (res.status === 401) throw new HiggsfieldPlanError("Higgsfield rejected the login token (HTTP 401).");
  if (!res.ok && res.status !== 202) {
    throw new HiggsfieldPlanError(`Higgsfield MCP returned HTTP ${res.status}.`, (await res.text().catch(() => "")).slice(0, 300));
  }
  if (!("id" in message)) return { sessionId: nextSession };

  const text = await res.text();
  const payload = parseMcpBody(text, message.id as number);
  if (payload?.error) {
    throw new HiggsfieldPlanError("Higgsfield MCP returned an error.", JSON.stringify(payload.error).slice(0, 300));
  }
  return { sessionId: nextSession, result: payload?.result };
}

/** Accepts a plain JSON-RPC body or an SSE stream of `data:` lines. Exported for tests. */
export function parseMcpBody(text: string, id: number): { result?: unknown; error?: unknown } | null {
  const candidates = text.trimStart().startsWith("{")
    ? [text]
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { id?: number; result?: unknown; error?: unknown };
      if (parsed.id === id) return parsed;
    } catch {
      // not JSON, skip
    }
  }
  return null;
}
