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

/**
 * Requires the signed-in user to be a platform admin (see
 * supabase/migrations/00000000000017_platform_admins.sql), redirecting
 * to / otherwise. This is the gate for src/app/platform-admin/ — the
 * registration screen that's the ONLY way a new agency/org comes into
 * existence, so it must never be reachable by a regular org member.
 *
 * Calls is_platform_admin() via RPC rather than querying
 * platform_admins directly — the table's own RLS policy already
 * requires is_platform_admin() to be true to read it at all, so a
 * direct select would be circular for a non-admin. The RPC is
 * SECURITY DEFINER and answers the question without that circularity.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  "use cache: private";

  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");

  if (!isAdmin) {
    redirect("/");
  }

  return user;
}

/**
 * Requires the signed-in user to be an owner or admin of the given
 * org, redirecting to / otherwise. Gate for /org/[orgId]/team — an
 * org's own team screen, scoped to that one org only (never another
 * agency's). Calls is_org_admin(org_id) via RPC for the same reason
 * requirePlatformAdmin() calls is_platform_admin(): org_members has
 * its own RLS, so a direct query can't distinguish "not a member" from
 * "member but not admin" without this explicit check.
 */
export async function requireOrgAdmin(orgId: string): Promise<CurrentUser> {
  "use cache: private";

  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_org_admin", {
    check_org_id: orgId,
  });

  if (!isAdmin) {
    redirect("/");
  }

  return user;
}
