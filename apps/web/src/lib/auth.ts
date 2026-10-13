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

/**
 * Same is_org_admin() check as requireOrgAdmin(), but returns a plain
 * boolean instead of redirecting — for a page that's visible to every
 * member but shows extra admin-only sections within itself (e.g.
 * Settings → Spend: every member sees the 24h spend/thresholds,
 * only an admin also sees the audit log and Resume button). Call
 * requireOrgMember() first for the page-level gate, then this for the
 * in-page admin check.
 */
export async function isOrgAdmin(orgId: string): Promise<boolean> {
  "use cache: private";

  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_org_admin", {
    check_org_id: orgId,
  });

  return Boolean(isAdmin);
}

/**
 * Requires the signed-in user to be an active member (any role) of the
 * given org. Gate for org-scoped editor content — brands, customers,
 * products — that every role can read and write per spec §4 ("browser
 * role gets select on its org's rows and insert or update only on
 * user-authored content"). This is a UX-layer redirect, same as
 * requireOrgAdmin(): the real boundary is each table's own RLS policy
 * (is_org_member(org_id)), so even if this check were skipped, a
 * non-member's queries would still return nothing.
 */
export async function requireOrgMember(orgId: string): Promise<CurrentUser> {
  "use cache: private";

  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: isMember } = await supabase.rpc("is_org_member", {
    check_org_id: orgId,
  });

  if (!isMember) {
    redirect("/");
  }

  return user;
}

/**
 * Owner-only counterpart to requireOrgAdmin(): team management, org-wide
 * provider keys, the audit log and resuming a paused org. Backed by
 * is_org_owner(org_id) (migration 52), which the matching RPCs also
 * check, so this is the UX redirect and the SQL is the real gate.
 */
export async function requireOrgOwner(orgId: string): Promise<CurrentUser> {
  "use cache: private";

  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_org_owner", {
    check_org_id: orgId,
  });

  if (!isOwner) {
    redirect("/");
  }

  return user;
}

/** Boolean form of requireOrgOwner(), for owner-only sections inside a wider page. */
export async function isOrgOwner(orgId: string): Promise<boolean> {
  "use cache: private";

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_org_owner", {
    check_org_id: orgId,
  });

  return Boolean(isOwner);
}
