"use server";

import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { AUTO_EDIT_MODES, type AutoEditMode, type ReviewIssue } from "@/lib/auto-edit/plan-schema";
import { autoEditErrorMessage, type AutoEditStatus } from "@/lib/auto-edit/messages";
import type { autoEdit } from "@/trigger/auto-edit";

/**
 * Auto-edit's entry points from the export step. Same shape as the other
 * generation actions: an RPC creates the row under the caller's own
 * session (request_auto_edit checks brand access, an archived ad or
 * brand, and one run per ad at a time), then the Trigger.dev task is
 * triggered with the agency as its concurrency key, so the render
 * queue's per-agency limit applies (lib/auto-edit/limits.ts).
 */

export type AutoEditRunView = {
  id: string;
  kind: "edit" | "revision";
  mode: AutoEditMode;
  status: AutoEditStatus;
  instruction: string | null;
  parentRunId: string | null;
  summary: string | null;
  reviewVerdict: "ship" | "fix" | null;
  reviewIssues: ReviewIssue[];
  /** Graphics that fell back from a designed version to a template, and why. */
  fallbacks: { id: string; reason: string }[];
  claudeUsd: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  previewUrl: string | null;
  finalUrl: string | null;
  finalDownloadUrl: string | null;
  queuePosition: number | null;
};

export type AutoEditState = {
  defaultMode: AutoEditMode;
  runs: AutoEditRunView[];
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function plainRpcError(message: string): string {
  if (/^(org_|brand_archived:)/.test(message)) return spendLimitMessage(message);
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
}

async function triggerRun(orgId: string, adId: string, runId: string): Promise<string | null> {
  try {
    await tasks.trigger<typeof autoEdit>(
      "auto-edit",
      { runId },
      { concurrencyKey: orgId, idempotencyKey: `auto-edit:${runId}`, tags: [`org_${orgId}`, `ad_${adId}`] }
    );
    return null;
  } catch (err) {
    // The run row exists but nothing will pick it up: close it so the ad isn't blocked.
    await createServiceClient()
      .from("auto_edit_runs")
      .update({ status: "failed", error_code: "INTERNAL", error: "Auto-edit could not be queued. Try again.", finished_at: new Date().toISOString() })
      .eq("id", runId);
    return err instanceof Error ? err.message : "trigger failed";
  }
}

export async function startAutoEdit(orgId: string, adId: string, mode: AutoEditMode): Promise<Result<{ runId: string }>> {
  await requireOrgMember(orgId);
  if (!AUTO_EDIT_MODES.includes(mode)) return { ok: false, error: "Pick Designed or Clean." };
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_auto_edit", { target_ad_id: adId, edit_mode: mode });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not start Auto-edit.") };
  const failed = await triggerRun(orgId, adId, data.id);
  if (failed) return { ok: false, error: "Auto-edit could not be queued. Try again." };
  return { ok: true, runId: data.id };
}

export async function requestAutoEditRevision(orgId: string, adId: string, runId: string, instruction: string): Promise<Result<{ runId: string }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_auto_edit_revision", { target_run_id: runId, revision_instruction: instruction });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not send the revision.") };
  if (data.ad_id !== adId) return { ok: false, error: "Ad not found." };
  const failed = await triggerRun(orgId, adId, data.id);
  if (failed) return { ok: false, error: "The revision could not be queued. Try again." };
  return { ok: true, runId: data.id };
}

export async function getAutoEditState(orgId: string, adId: string): Promise<Result<AutoEditState>> {
  await requireOrgMember(orgId);
  const ad = await getAccessibleAd(orgId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  // Read through the caller's session: auto_edit_runs_select is brand-scoped.
  const supabase = await createClient();
  const [{ data: runs, error }, { data: brand }] = await Promise.all([
    supabase
      .from("auto_edit_runs")
      .select("id, kind, mode, status, instruction, parent_run_id, plan, review, graphics, claude_usd, error, error_code, created_at, started_at, finished_at, preview_asset_id, final_asset_id")
      .eq("org_id", orgId)
      .eq("ad_id", adId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("brands").select("auto_edit_mode").eq("id", ad.brand_id).maybeSingle(),
  ]);
  if (error) return { ok: false, error: "Could not load Auto-edit." };

  // Sign the preview and final videos (renders is a private bucket).
  const assetIds = (runs ?? []).flatMap((r) => [r.preview_asset_id, r.final_asset_id]).filter((x): x is string => Boolean(x));
  const service = createServiceClient();
  const pathById = new Map<string, string>();
  if (assetIds.length) {
    const { data: assets } = await service.from("assets").select("id, storage_path").eq("org_id", orgId).eq("ad_id", adId).in("id", assetIds);
    for (const a of assets ?? []) pathById.set(a.id, a.storage_path);
  }
  const sign = async (id: string | null, download?: string) => {
    const path = id ? pathById.get(id) : undefined;
    if (!path) return null;
    const { data } = await service.storage.from("renders").createSignedUrl(path, 3600, download ? { download } : undefined);
    return data?.signedUrl ?? null;
  };

  const views: AutoEditRunView[] = [];
  for (const r of runs ?? []) {
    const graphics = (r.graphics ?? []) as { id: string; fallback?: string }[];
    const review = r.review as { verdict: "ship" | "fix"; issues: ReviewIssue[] } | null;
    const queuePosition =
      r.status === "queued" ? ((await supabase.rpc("auto_edit_queue_position", { target_run_id: r.id })).data as number | null) : null;
    views.push({
      id: r.id,
      kind: r.kind,
      mode: r.mode,
      status: r.status,
      instruction: r.instruction,
      parentRunId: r.parent_run_id,
      summary: (r.plan as { summary?: string } | null)?.summary ?? null,
      reviewVerdict: review?.verdict ?? null,
      reviewIssues: review?.issues ?? [],
      fallbacks: graphics.filter((g) => g.fallback).map((g) => ({ id: g.id, reason: g.fallback! })),
      claudeUsd: Number(r.claude_usd ?? 0),
      error: r.status === "failed" ? r.error || autoEditErrorMessage(r.error_code) : r.error,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      previewUrl: await sign(r.preview_asset_id),
      finalUrl: await sign(r.final_asset_id),
      finalDownloadUrl: await sign(r.final_asset_id, `auto-edit-${r.mode}-${r.id.slice(0, 8)}.mp4`),
      queuePosition,
    });
  }

  const brandMode = brand?.auto_edit_mode as AutoEditMode | null | undefined;
  return { ok: true, defaultMode: brandMode ?? "designed", runs: views };
}
