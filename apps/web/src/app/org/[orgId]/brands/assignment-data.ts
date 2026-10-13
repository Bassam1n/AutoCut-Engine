import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AssignableUser = {
  id: string;
  name: string | null;
  email: string;
};

/**
 * Users (editors) with an active seat: the only people a brand can be
 * assigned to, since owners and admins already see every brand.
 * list_org_team is owner/admin-gated, matching who can assign.
 */
export async function getAssignableUsers(orgId: string): Promise<AssignableUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_team", { target_org_id: orgId });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(
      (m: { member_role: string; member_seat_active: boolean }) =>
        m.member_role === "editor" && m.member_seat_active
    )
    .map((m: { member_user_id: string; member_full_name: string | null; member_email: string }) => ({
      id: m.member_user_id,
      name: m.member_full_name,
      email: m.member_email,
    }));
}

/** brand_id -> active assignee user ids, for one org. */
export async function getAssigneeIdsByBrand(orgId: string): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_assignments")
    .select("brand_id, user_id")
    .eq("org_id", orgId)
    .eq("active", true);
  if (error) throw new Error(error.message);

  const byBrand = new Map<string, string[]>();
  for (const row of data ?? []) {
    byBrand.set(row.brand_id, [...(byBrand.get(row.brand_id) ?? []), row.user_id]);
  }
  return byBrand;
}
