import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrgSpendStatus = {
  spend24h: number;
  warnUsd: number;
  stopUsd: number;
  paused: boolean;
  pauseReason: string | null;
};

export async function getOrgSpendStatus(orgId: string): Promise<OrgSpendStatus> {
  const supabase = await createClient();

  const [orgResult, spendResult] = await Promise.all([
    supabase
      .from("orgs")
      .select("warn_usd, stop_usd, paused, pause_reason")
      .eq("id", orgId)
      .single(),
    supabase.rpc("org_spend_24h", { target_org_id: orgId }),
  ]);

  if (orgResult.error) throw new Error(orgResult.error.message);
  if (spendResult.error) throw new Error(spendResult.error.message);

  return {
    spend24h: spendResult.data ?? 0,
    warnUsd: orgResult.data.warn_usd,
    stopUsd: orgResult.data.stop_usd,
    paused: orgResult.data.paused,
    pauseReason: orgResult.data.pause_reason,
  };
}

export type AuditLogRow = {
  id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  created_at: string;
};

/**
 * Org-scoped audit log, newest first. actor is nullable on system-
 * triggered rows (spend_guard_paused/warn write actor: null — see
 * 00000000000012_spend_tokens_audit.sql) so this left-joins auth.users
 * rather than inner-joining, and falls back to "System" in the UI.
 * Kept as an RPC (rather than a direct select) for two reasons: it
 * needs the same auth.users join list_org_members() in
 * 00000000000021_org_admin_team.sql does under RLS, and audit_log's
 * own select policy (audit_log_select_admin,
 * 00000000000012_spend_tokens_audit.sql) is already admin-only — this
 * page is gated with requireOrgAdmin() for exactly that reason, so a
 * direct select would have worked too, but the RPC keeps the email
 * join in one place rather than duplicating it in app code.
 */
export async function getOrgAuditLog(orgId: string, limit = 50): Promise<AuditLogRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_audit_log", {
    target_org_id: orgId,
    row_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
