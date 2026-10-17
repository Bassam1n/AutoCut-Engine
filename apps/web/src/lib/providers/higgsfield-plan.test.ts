import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { authorizeUrl, createPkce, parseMcpBody } from "./higgsfield-plan";

describe("higgsfield-plan", () => {
  it("createPkce() returns an S256 challenge of its verifier", async () => {
    const { verifier, challenge } = await createPkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("authorizeUrl() targets Higgsfield's OAuth server with PKCE", () => {
    const url = new URL(
      authorizeUrl({ clientId: "abc", redirectUri: "https://app.test/cb", state: "s1", codeChallenge: "ch" })
    );
    expect(url.origin + url.pathname).toBe("https://mcp.higgsfield.ai/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "abc",
      redirect_uri: "https://app.test/cb",
      state: "s1",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });

  it("parseMcpBody() reads a plain JSON-RPC body", () => {
    expect(parseMcpBody('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', 2)).toMatchObject({ result: { tools: [] } });
  });

  it("parseMcpBody() reads the matching message out of an SSE stream", () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"generate_image"}]}}\n\n';
    expect(parseMcpBody(sse, 2)).toMatchObject({ result: { tools: [{ name: "generate_image" }] } });
  });
});
