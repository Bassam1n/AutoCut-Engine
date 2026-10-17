/**
 * Turns a caller-supplied redirect target (?next=, ?returnTo=, a stored
 * notification link) into a same-origin path, or null when it points
 * anywhere else. Rejects protocol-relative ("//host") and backslash
 * ("/\host") forms that browsers resolve to another origin.
 */
export function sameOriginPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Same as sameOriginPath, falling back to "/". */
export function safeNext(raw: string | null | undefined, origin: string): string {
  return sameOriginPath(raw, origin) ?? "/";
}
