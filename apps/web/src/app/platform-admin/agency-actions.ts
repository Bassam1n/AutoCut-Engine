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

export async function setAgencyPlan(
  orgId: string,
  plan: Plan,
  seatCap: number | null,
  brandCap: number | null,
  storageQuotaGb: number | null
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_plan", {
    target_org_id: orgId,
    new_plan: plan,
    new_seat_cap: seatCap,
    new_brand_cap: brandCap,
    new_storage_quota_gb: storageQuotaGb,
  });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export type PaymentInput = {
  amount: number;
  currency: string;
  paidOn: string;
  periodEnd: string;
  method: "cash" | "bank_transfer" | "card" | "other";
  note: string;
};

export async function recordPayment(orgId: string, input: PaymentInput): Promise<ActionResult> {
  await requirePlatformAdmin();
  if (!(input.amount >= 0)) return { ok: false, error: "Enter the amount received." };
  if (!input.periodEnd) return { ok: false, error: "Pick the date this payment covers until." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_record_payment", {
    target_org_id: orgId,
    pay_amount: input.amount,
    pay_currency: input.currency || "USD",
    pay_paid_on: input.paidOn,
    pay_period_end: input.periodEnd,
    pay_method: input.method,
    pay_note: input.note,
  });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export async function voidPayment(orgId: string, paymentId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_void_payment", { target_payment_id: paymentId });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}

export async function setPaidUntil(orgId: string, paidUntil: string | null): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_paid_until", { target_org_id: orgId, new_paid_until: paidUntil });
  if (error) return { ok: false, error: error.message };
  refresh(orgId);
  return { ok: true };
}
