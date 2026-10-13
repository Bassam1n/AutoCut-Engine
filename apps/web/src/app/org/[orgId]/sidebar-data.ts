import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/roles";

export type SidebarInfo = {
  orgName: string;
  role: OrgRole | null;
  isAdmin: boolean;
  /** member_can_create_ads(): null column means the role default (users yes). */
  canCreateAds: boolean;
  userEmail: string;
  fullName: string | null;
  avatarPath: string | null;
  unreadNotifications: number;
};

export async function getSidebarInfo(orgId: string): Promise<SidebarInfo | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const [orgResult, memberResult, profileResult, unreadResult] = await Promise.all([
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("org_members")
      .select("role, can_create_ads")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, avatar_path")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("read_at", null),
  ]);

  if (!orgResult.data) return null;

  const role = (memberResult.data?.role as OrgRole | undefined) ?? null;

  return {
    orgName: orgResult.data.name,
    role,
    isAdmin: role === "owner" || role === "admin",
    canCreateAds: memberResult.data?.can_create_ads ?? role === "editor",
    userEmail: user.email,
    fullName: profileResult.data?.full_name ?? null,
    avatarPath: profileResult.data?.avatar_path ?? null,
    unreadNotifications: unreadResult.count ?? 0,
  };
}
