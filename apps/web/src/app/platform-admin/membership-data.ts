import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrgMemberRow = {
  org_id: string;
  org_name: string;
  org_paused: boolean;
  org_seat_cap: number | null;
  member_user_id: string | null;
  member_email: string | null;
  member_role: "owner" | "admin" | "editor" | null;
  member_seat_active: boolean | null;
  member_joined_at: string | null;
};

export type PendingInviteRow = {
  invite_id: string;
  org_id: string;
  org_name: string;
  email: string;
  role: "owner" | "admin" | "editor";
  invited_at: string;
};

export async function getAllOrgsWithMembers(): Promise<OrgMemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_all_orgs_with_members");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAllPendingInvites(): Promise<PendingInviteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_all_pending_invites");
  if (error) throw new Error(error.message);
  return data ?? [];
}
