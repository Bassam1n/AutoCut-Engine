import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
};

/**
 * The Data Access Layer entry point for "who is signed in." Per
 * docs/adr/001-nextjs-cache-components.md: this is the ONE place that
 * reads the session. Everything else — pages, Server Actions, other
 * helpers — calls this instead of touching cookies()/supabase.auth
 * directly, so there's one audited chokepoint instead of N.
 *
 * "use cache: private" is required here, not a plain "use cache": this
 * function reads a request-scoped session, so its result can only ever
 * be cached per-browser, never shared across users on the server.
 *
 * Every caller must sit behind a <Suspense> boundary — reading the
 * session can't be part of the prerendered static shell.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  "use cache: private";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/login");
  }

  return { id: user.id, email: user.email };
}

/**
 * Like getCurrentUser(), but returns null instead of redirecting. Use on
 * pages that render differently for signed-out visitors (the login page
 * itself, a public landing page) rather than always requiring auth.
 */
export async function getCurrentUserOrNull(): Promise<CurrentUser | null> {
  "use cache: private";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return null;
  }

  return { id: user.id, email: user.email };
}
