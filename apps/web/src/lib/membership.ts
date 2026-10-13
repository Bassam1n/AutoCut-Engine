import "server-only";
import { createClient } from "./supabase/server";
import type { OrgRole } from "./roles";

export type MyMembership = {
  userId: string;
  email: string;
  role: OrgRole | null;
  seatActive: boolean;
};

/** The signed-in user's own row in org_members for this org (null role if not a member). */
export async function getMyMembership(orgId: string): Promise<MyMembership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data } = await supabase
    .from("org_members")
    .select("role, seat_active")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email,
    role: (data?.role as OrgRole | undefined) ?? null,
    seatActive: Boolean(data?.seat_active),
  };
}
