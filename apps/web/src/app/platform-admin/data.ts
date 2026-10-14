import "server-only";
import { createClient } from "@/lib/supabase/server";

// Every function here calls a platform-admin-only RPC (migration 58),
// which raises for anyone else. Pages also gate with requirePlatformAdmin.

import type { AgencySummary } from "./model";
export { PLANS, PLAN_LABELS, agencyIssues, agencyStatus, type AgencyStatus, type AgencySummary, type Plan } from "./model";

export async function getAgencies(): Promise<AgencySummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_org_overview");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: AgencySummary) => ({
    ...row,
    spend_24h: Number(row.spend_24h),
    spend_7d: Number(row.spend_7d),
    spend_30d: Number(row.spend_30d),
    warn_usd: row.warn_usd === null ? null : Number(row.warn_usd),
    stop_usd: row.stop_usd === null ? null : Number(row.stop_usd),
  }));
}

export type DailySpend = { day: string; usd: number; events: number };

export async function getDailySpend(days: number, orgId?: string): Promise<DailySpend[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_daily_spend", { days, target_org_id: orgId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { day: string; usd: number; events: number }) => ({ day: r.day, usd: Number(r.usd), events: r.events }));
}

export type SpendBreakdownRow = { provider: string; kind: string; usd: number; events: number };

export async function getSpendBreakdown(orgId: string, days: number): Promise<SpendBreakdownRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_spend_breakdown", { target_org_id: orgId, days });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: SpendBreakdownRow) => ({ ...r, usd: Number(r.usd) }));
}

export type ActivityRow = {
  id: string;
  org_id: string;
  org_name: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  created_at: string;
};

export async function getActivity(orgId: string | null, limit: number): Promise<ActivityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_audit_log", { target_org_id: orgId, row_limit: limit });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type AgencyBrand = {
  brand_id: string;
  brand_name: string;
  active: boolean;
  products: number;
  ads: number;
  assignees: number;
  created_at: string;
};

export async function getAgencyBrands(orgId: string): Promise<AgencyBrand[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_org_brands", { target_org_id: orgId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type AgencyMember = {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "editor";
  seat_active: boolean;
  joined_at: string;
  can_create_ads: boolean | null;
};

export type AgencyInvite = { invite_id: string; email: string; role: "owner" | "admin" | "editor"; invited_at: string };

export async function getAgencyMembers(orgId: string): Promise<{ members: AgencyMember[]; invites: AgencyInvite[] }> {
  const supabase = await createClient();
  const [membersResult, permsResult, invitesResult] = await Promise.all([
    supabase.rpc("list_all_orgs_with_members"),
    supabase.rpc("list_all_member_permissions"),
    supabase.rpc("list_all_pending_invites"),
  ]);
  if (membersResult.error) throw new Error(membersResult.error.message);
  if (permsResult.error) throw new Error(permsResult.error.message);
  if (invitesResult.error) throw new Error(invitesResult.error.message);

  const adAccess = new Map(
    (permsResult.data ?? [])
      .filter((p: { org_id: string }) => p.org_id === orgId)
      .map((p: { user_id: string; can_create_ads: boolean | null }) => [p.user_id, p.can_create_ads])
  );

  type Row = {
    org_id: string;
    member_user_id: string | null;
    member_email: string | null;
    member_role: AgencyMember["role"] | null;
    member_seat_active: boolean | null;
    member_joined_at: string | null;
  };
  const members: AgencyMember[] = (membersResult.data ?? [])
    .filter((r: Row) => r.org_id === orgId && r.member_user_id)
    .map((r: Row) => ({
      user_id: r.member_user_id!,
      email: r.member_email ?? "",
      role: r.member_role!,
      seat_active: Boolean(r.member_seat_active),
      joined_at: r.member_joined_at ?? "",
      can_create_ads: (adAccess.get(r.member_user_id!) as boolean | null | undefined) ?? null,
    }))
    .sort((a: AgencyMember, b: AgencyMember) => {
      const order = { owner: 0, admin: 1, editor: 2 };
      return order[a.role] - order[b.role];
    });

  const invites: AgencyInvite[] = (invitesResult.data ?? [])
    .filter((i: { org_id: string }) => i.org_id === orgId)
    .map((i: { invite_id: string; email: string; role: AgencyInvite["role"]; invited_at: string }) => ({
      invite_id: i.invite_id,
      email: i.email,
      role: i.role,
      invited_at: i.invited_at,
    }));

  return { members, invites };
}

export type PlatformAdmin = { user_id: string; email: string; created_at: string };

export async function getPlatformAdmins(): Promise<PlatformAdmin[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_platform_admins");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Human wording for audit_log actions. */
export function describeAction(action: string): string {
  const labels: Record<string, string> = {
    agency_registered: "Agency registered",
    agency_updated: "Agency details updated",
    agency_suspended: "Agency suspended",
    agency_reactivated: "Agency reactivated",
    org_created: "Organization created",
    invite_accepted: "Invite accepted",
    member_invited: "Member invited",
    invite_revoked: "Invite revoked",
    member_role_changed: "Role changed",
    member_seat_activated: "Seat reactivated",
    member_seat_deactivated: "Seat deactivated",
    member_email_changed: "Email changed",
    member_ad_access_changed: "Ad access changed",
    member_brand_access_changed: "Product access changed",
    brand_assignees_changed: "Brand assignees changed",
    seat_cap_changed: "Seat cap changed",
    spend_limits_changed: "Spend limits changed",
    spend_guard_warn: "Spend warning reached",
    spend_guard_paused: "Paused by spend guard",
    spend_guard_resumed: "Spend resumed",
    org_resumed: "Resumed",
    org_secret_saved: "Provider key saved",
    brand_secret_saved: "Brand key saved",
    slack_connected: "Slack connected",
    slack_disconnected: "Slack disconnected",
  };
  if (labels[action]) return labels[action];
  if (action.startsWith("gate_")) return `Gate ${action.slice(5).replace(/_/g, " ")}`;
  return action.replace(/_/g, " ");
}

/** Server clock for client tables that show relative times, read after the request's dynamic data. */
export function serverNow(): number {
  return Date.now();
}
