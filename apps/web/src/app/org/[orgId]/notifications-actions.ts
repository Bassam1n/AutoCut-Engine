"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** The signed-in user's latest notifications in this org (notifications_select_own RLS). */
export async function listMyNotifications(orgId: string): Promise<NotificationItem[]> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Marks some (or, with null, all) of the user's notifications read. */
export async function markNotificationsRead(orgId: string, ids: string[] | null): Promise<void> {
  await requireOrgMember(orgId);
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { notification_ids: ids });
  revalidatePath(`/org/${orgId}`, "layout");
}
