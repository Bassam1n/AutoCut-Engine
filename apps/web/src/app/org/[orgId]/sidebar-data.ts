import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SidebarInfo = {
  orgName: string;
  isAdmin: boolean;
  userEmail: string;
};

export async function getSidebarInfo(orgId: string): Promise<SidebarInfo | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const [orgResult, memberResult] = await Promise.all([
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!orgResult.data) return null;

  const role = memberResult.data?.role;

  return {
    orgName: orgResult.data.name,
    isAdmin: role === "owner" || role === "admin",
    userEmail: user.email,
  };
}
