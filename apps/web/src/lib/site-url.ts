import "server-only";
import { headers } from "next/headers";

/**
 * The origin the current request came in on (e.g. https://studio.autocutengine.app),
 * falling back to NEXT_PUBLIC_SITE_URL. Sign-in links must return to the same
 * origin they were requested from: the PKCE verifier cookie lives there, so a
 * link that lands on another domain can't finish signing in. Supabase still
 * checks the result against its Redirect URLs allowlist.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}
