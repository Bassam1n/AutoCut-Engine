import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/roles";

export type SidebarInfo = {
  orgName: string;
  role: OrgRole | null;
  isAdmin: boolean;
  userEmail: string;
  fullName: string | null;
  avatarPath: string | null;
};

export async function getSidebarInfo(orgId: string): Promise<SidebarInfo | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const [orgResult, memberResult, profileResult] = await Promise.all([
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, avatar_path")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!orgResult.data) return null;

  const role = (memberResult.data?.role as OrgRole | undefined) ?? null;

  return {
    orgName: orgResult.data.name,
    role,
    isAdmin: role === "owner" || role === "admin",
    userEmail: user.email,
    fullName: profileResult.data?.full_name ?? null,
    avatarPath: profileResult.data?.avatar_path ?? null,
  };
}
