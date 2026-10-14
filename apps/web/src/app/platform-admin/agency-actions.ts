"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { generateSignInLink } from "@/lib/invite-link";
import type { Plan } from "./data";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type LinkResult = { ok: true; link: string } | { ok: false; error: string };

// Every RPC here re-checks is_platform_admin() and audit-logs the change.

function refresh(orgId?: string) {
  revalidatePath("/platform-admin", "layout");
  if (orgId) revalidatePath(`/platform-admin/agencies/${orgId}`);
}

export async function setAgencySuspended(orgId: string, suspend: boolean, reason: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_suspended", {
    target_org_id: orgId,
    suspend,
    reason: reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export async function updateAgency(orgId: string, name: string, plan: Plan, notes: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_update_org", {
    target_org_id: orgId,
    new_name: name,
    new_plan: plan,
    new_notes: notes,
  });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export async function setSpendLimits(orgId: string, warnUsd: number, stopUsd: number): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_spend_limits", {
    target_org_id: orgId,
    new_warn_usd: warnUsd,
    new_stop_usd: stopUsd,
  });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export async function resumeAgency(orgId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_resume_org", { target_org_id: orgId });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

/** Invites someone into an existing agency and returns a sign-in link to send them. */
export async function inviteToAgency(
  orgId: string,
  email: string,
  role: "owner" | "admin" | "editor"
): Promise<LinkResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_invite_member", {
    target_org_id: orgId,
    invitee_email: email.trim(),
    invitee_role: role,
  });
  if (error) return { ok: false, error: error.message };

  const link = await generateSignInLink(email.trim().toLowerCase());
  refresh(orgId);
  if (!link.ok) return { ok: false, error: `Invite saved, but the link couldn't be generated: ${link.error}` };
  return { ok: true, link: link.link };
}

/** A fresh sign-in link for a pending invite (links expire, so this is the "resend"). */
export async function regenerateInviteLink(email: string): Promise<LinkResult> {
  await requirePlatformAdmin();
  return generateSignInLink(email.trim().toLowerCase());
}

export async function addPlatformAdmin(email: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_platform_admin", { admin_email: email });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/platform-admin/admins");
  return { ok: true };
}

export async function revokePlatformAdmin(userId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_platform_admin", { target_user_id: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/platform-admin/admins");
  return { ok: true };
}
