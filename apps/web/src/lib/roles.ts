/**
 * Org membership roles as stored in org_members.role, and how they read
 * on screen. "editor" is shown as "User" everywhere in the UI.
 */
export type OrgRole = "owner" | "admin" | "editor";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "User",
};

/** Roles an owner can hand out inside their org. Owner itself is platform-admin only. */
export const ASSIGNABLE_ORG_ROLES = ["admin", "editor"] as const satisfies readonly OrgRole[];

/** Public URL for a profile photo stored in the public "avatars" bucket. */
export function avatarUrl(avatarPath: string | null | undefined): string | null {
  if (!avatarPath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/avatars/${avatarPath}`;
}
