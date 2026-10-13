import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/roles";

export type OrgTeamMember = {
  member_user_id: string;
  member_email: string;
  member_role: OrgRole;
  member_seat_active: boolean;
  member_joined_at: string;
  member_full_name: string | null;
  member_avatar_path: string | null;
};

export type OrgPendingInvite = {
  invite_id: string;
  email: string;
  role: OrgRole;
  invited_at: string;
};

export type OrgSeatInfo = {
  seatCap: number | null;
  seatUsage: number;
};

export async function getOrgMembers(orgId: string): Promise<OrgTeamMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_team", {
    target_org_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getOrgPendingInvites(orgId: string): Promise<OrgPendingInvite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_pending_invites", {
    target_org_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getOrgSeatInfo(orgId: string): Promise<OrgSeatInfo> {
  const supabase = await createClient();
  const [orgResult, usageResult] = await Promise.all([
    supabase.from("orgs").select("seat_cap").eq("id", orgId).single(),
    supabase.rpc("org_seat_usage", { check_org_id: orgId }),
  ]);

  if (orgResult.error) throw new Error(orgResult.error.message);
  if (usageResult.error) throw new Error(usageResult.error.message);

  return {
    seatCap: orgResult.data?.seat_cap ?? null,
    seatUsage: usageResult.data ?? 0,
  };
}
