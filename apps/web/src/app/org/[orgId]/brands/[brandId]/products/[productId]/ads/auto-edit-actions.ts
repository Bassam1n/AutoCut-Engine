"use server";

import "server-only";
import { tasks } from "@trigger.dev/sdk";
import { requireOrgMember } from "@/lib/auth";
import { getAccessibleAd } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { spendLimitMessage } from "@/lib/spend-limit-message";
import { storageFullError } from "@/lib/storage-quota";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/auto-edit/exports/bundle";
import { autoEditErrorMessage, type AutoEditStatus } from "@/lib/auto-edit/messages";
import { AUTO_EDIT_MODES, EditPlan, type AutoEditMode, type ReviewIssue } from "@/lib/auto-edit/plan-schema";
import { planFromScenes } from "@/lib/auto-edit/timeline-ops";
import { latestByScene, voiceoverMode } from "@/lib/auto-edit/voiceover-mode";
import type { adRender } from "@/trigger/ad-render";
import type { autoEdit } from "@/trigger/auto-edit";

/**
 * Auto-edit on the export step: Claude's edits (Designed / Clean and the
 * revision chat), the editable timeline they write to, and the render
 * worker's "Render MP4" and "Export project for..." jobs. Every write
 * goes through an RPC under the caller's own session (brand access,
 * archived ad or brand, one job at a time, the timeline's version), then
 * the Trigger.dev task is triggered with the agency as its concurrency
 * key, so the render queue's per-agency limit applies.
 */

export type AutoEditRunView = {
  id: string;
  kind: "edit" | "revision";
  mode: AutoEditMode;
  status: AutoEditStatus;
  instruction: string | null;
  summary: string | null;
  reviewVerdict: "ship" | "fix" | null;
  reviewIssues: ReviewIssue[];
  fallbacks: { id: string; reason: string }[];
  claudeUsd: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queuePosition: number | null;
};

export type TimelineView = {
  plan: EditPlan;
  version: number;
  mode: AutoEditMode;
  findings: ReviewIssue[];
  clipDurations: Record<number, number>;
  sourceRunId: string | null;
  updatedAt: string;
};

export type EditorScene = {
  index: number;
  copy: string;
  videoUrl: string | null;
  voiceoverUrl: string | null;
  /** "separate" voiceovers are played on their own track; "inClip" ones are in the video. */
  voiceoverMode: "separate" | "inClip" | null;
  /** Set for a clip the editor uploaded (index 1000 and up). */
  upload?: { assetId: string; name: string; duration: number };
};

export type RenderView = {
  id: string;
  kind: "mp4" | "export";
  format: ExportFormat | null;
  status: "queued" | "rendering" | "succeeded" | "failed" | "cancelled";
  timelineVersion: number;
  error: string | null;
  notes: string[];
  createdAt: string;
  finishedAt: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
  files: { path: string; url: string; bytes: number }[];
};

export type AutoEditState = {
  defaultMode: AutoEditMode;
  runs: AutoEditRunView[];
  timeline: TimelineView | null;
  scenes: EditorScene[];
  renders: RenderView[];
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };

function plainRpcError(message: string): string {
  if (/^(org_|brand_archived:)/.test(message)) return spendLimitMessage(message);
  if (/^timeline_conflict:/.test(message)) return "The timeline changed in another tab or by Auto-edit. Reload to get the latest version.";
  if (/^timeline_locked:/.test(message)) return "Auto-edit is working on this timeline. Edits are paused until it finishes.";
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
}

async function triggerAutoEdit(orgId: string, adId: string, runId: string): Promise<boolean> {
  try {
    await tasks.trigger<typeof autoEdit>("auto-edit", { runId }, { concurrencyKey: orgId, idempotencyKey: `auto-edit:${runId}`, tags: [`org_${orgId}`, `ad_${adId}`] });
    return true;
  } catch {
    // The row exists but nothing will pick it up: close it so the ad isn't blocked.
    await createServiceClient().from("auto_edit_runs")
      .update({ status: "failed", error_code: "INTERNAL", error: "Auto-edit could not be queued. Try again.", finished_at: new Date().toISOString() })
      .eq("id", runId);
    return false;
  }
}

export async function startAutoEdit(orgId: string, adId: string, mode: AutoEditMode): Promise<Result<{ runId: string }>> {
  await requireOrgMember(orgId);
  if (!AUTO_EDIT_MODES.includes(mode)) return { ok: false, error: "Pick Designed or Clean." };
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_auto_edit", { target_ad_id: adId, edit_mode: mode });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not start Auto-edit.") };
  if (!(await triggerAutoEdit(orgId, adId, data.id))) return { ok: false, error: "Auto-edit could not be queued. Try again." };
  return { ok: true, runId: data.id };
}

/** A revision chat turn on the current timeline (manual edits included). Review findings always go with it. */
export async function requestAutoEditRevision(orgId: string, adId: string, instruction: string): Promise<Result<{ runId: string }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_auto_edit_revision_for_ad", { target_ad_id: adId, revision_instruction: instruction });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not send the revision.") };
  if (!(await triggerAutoEdit(orgId, adId, data.id))) return { ok: false, error: "The revision could not be queued. Try again." };
  return { ok: true, runId: data.id };
}

/** The editor's autosave. Fails with conflict: true when the timeline moved on. */
export async function saveTimeline(orgId: string, adId: string, plan: unknown, version: number): Promise<Result<{ version: number }>> {
  await requireOrgMember(orgId);
  const parsed = EditPlan.safeParse(plan);
  if (!parsed.success) return { ok: false, error: "That edit isn't valid; undo it and try again." };
  if (JSON.stringify(parsed.data).length > 900_000) return { ok: false, error: "The timeline is too large to save." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_ad_timeline", { target_ad_id: adId, new_plan: parsed.data, expected_version: version });
  if (error || !data) {
    const msg = error?.message ?? "";
    return { ok: false, error: plainRpcError(msg || "Could not save."), conflict: /^timeline_(conflict|locked):/.test(msg) };
  }
  return { ok: true, version: data.version };
}

/** "Start from the scenes": every scene end to end with its script as captions, no Claude. */
export async function startTimelineFromScenes(orgId: string, adId: string, durations: Record<string, number>): Promise<Result<{ version: number }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const clean: Record<number, number> = {};
  for (const [k, v] of Object.entries(durations ?? {})) {
    if (/^\d+$/.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0 && v < 600) clean[Number(k)] = Math.round(v * 1000) / 1000;
  }
  const supabase = await createClient();
  const { data: scenes } = await supabase.from("scenes").select("idx, copy").eq("org_id", orgId).eq("ad_id", adId).order("idx");
  const plan = planFromScenes((scenes ?? []).map((s) => ({ index: s.idx, copy: s.copy ?? "" })), clean);
  if (!plan.clips.length) return { ok: false, error: "None of the scene videos could be read yet. Wait for them to load and try again." };
  const { data, error } = await supabase.rpc("create_ad_timeline", { target_ad_id: adId, new_plan: plan, timeline_mode: "clean", durations: clean });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not start the timeline.") };
  return { ok: true, version: data.version };
}

/** Puts an earlier Auto-edit cut back on the timeline. */
export async function restoreAutoEditCut(orgId: string, adId: string, runId: string): Promise<Result<{ version: number }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_auto_edit_cut", { target_run_id: runId });
  if (error || !data || data.ad_id !== adId) return { ok: false, error: plainRpcError(error?.message ?? "Could not restore that cut.") };
  return { ok: true, version: data.version };
}

/** "Render MP4" (kind mp4) or "Export project for..." (kind export) from the saved timeline. */
export async function requestRender(orgId: string, adId: string, kind: "mp4" | "export", format?: ExportFormat): Promise<Result<{ renderId: string }>> {
  await requireOrgMember(orgId);
  if (kind === "export" && (!format || !EXPORT_FORMATS.includes(format))) return { ok: false, error: "Pick a format." };
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_ad_render", { target_ad_id: adId, render_kind: kind, export_format: kind === "export" ? format : null });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not start the render.") };
  try {
    await tasks.trigger<typeof adRender>("ad-render", { renderId: data.id }, { concurrencyKey: orgId, idempotencyKey: `ad-render:${data.id}`, tags: [`org_${orgId}`, `ad_${adId}`] });
  } catch {
    await createServiceClient().from("ad_renders")
      .update({ status: "failed", error_code: "INTERNAL", error: "The render could not be queued. Try again.", finished_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: false, error: "The render could not be queued. Try again." };
  }
  return { ok: true, renderId: data.id };
}

/** Largest clip the editor can upload: the storage upload limit on the current plan. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Step 1 of uploading a clip from the device: checks access, the agency's
 * storage and the file, and says where the browser should put it.
 */
export async function reserveTimelineUpload(orgId: string, adId: string, fileName: string, bytes: number, type: string): Promise<Result<{ path: string }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  if (!type.startsWith("video/")) return { ok: false, error: "Pick a video file (MP4 or MOV)." };
  if (!(bytes > 0) || bytes > MAX_UPLOAD_BYTES) return { ok: false, error: "Clips can be up to 50 MB. Export a shorter or smaller version and try again." };
  const full = await storageFullError(orgId);
  if (full) return { ok: false, error: full };
  const supabase = await createClient();
  const { data: folder, error } = await supabase.rpc("timeline_upload_folder", { target_ad_id: adId });
  if (error || !folder) return { ok: false, error: plainRpcError(error?.message ?? "Could not start the upload.") };
  const safe = fileName.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "clip.mp4";
  return { ok: true, path: `${folder}${crypto.randomUUID()}-${safe}` };
}

/** Step 2: records the uploaded file as one of the ad's clips. */
export async function addTimelineUpload(
  orgId: string, adId: string, path: string, meta: { name: string; duration: number; width: number; height: number }
): Promise<Result<{ scene: EditorScene }>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_timeline_upload", {
    target_ad_id: adId,
    upload_path: path,
    clip_meta: { name: String(meta.name ?? "").slice(0, 120), duration: Number(meta.duration), width: Math.round(Number(meta.width) || 0), height: Math.round(Number(meta.height) || 0) },
  });
  if (error || !data) return { ok: false, error: plainRpcError(error?.message ?? "Could not add the clip.") };
  const { data: signed } = await createServiceClient().storage.from("renders").createSignedUrl(data.storage_path, 3600);
  const m = data.meta as { clipIndex: number; name: string; duration: number };
  return {
    ok: true,
    scene: { index: m.clipIndex, copy: "", videoUrl: signed?.signedUrl ?? null, voiceoverUrl: null, voiceoverMode: null, upload: { assetId: data.id, name: m.name, duration: Number(m.duration) } },
  };
}

/** Takes an uploaded clip out of the ad's media (not while the timeline uses it). */
export async function removeTimelineUpload(orgId: string, adId: string, assetId: string): Promise<Result<object>> {
  await requireOrgMember(orgId);
  if (!(await getAccessibleAd(orgId, adId))) return { ok: false, error: "Ad not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_timeline_upload", { target_asset_id: assetId });
  if (error) return { ok: false, error: plainRpcError(error.message) };
  return { ok: true };
}

export async function getAutoEditState(orgId: string, adId: string): Promise<Result<AutoEditState>> {
  await requireOrgMember(orgId);
  const ad = await getAccessibleAd(orgId, adId);
  if (!ad) return { ok: false, error: "Ad not found." };

  // Reads through the caller's session: every table here is brand-scoped.
  const supabase = await createClient();
  const [{ data: runs, error }, { data: brand }, { data: timeline }, { data: renders }, { data: scenes }] = await Promise.all([
    supabase.from("auto_edit_runs")
      .select("id, kind, mode, status, instruction, plan, review, graphics, claude_usd, error, error_code, created_at, started_at, finished_at")
      .eq("org_id", orgId).eq("ad_id", adId).order("created_at", { ascending: false }).limit(20),
    supabase.from("brands").select("auto_edit_mode").eq("id", ad.brand_id).maybeSingle(),
    supabase.from("ad_timelines").select("plan, version, mode, findings, clip_durations, source_run_id, updated_at").eq("ad_id", adId).maybeSingle(),
    supabase.from("ad_renders")
      .select("id, kind, format, status, timeline_version, asset_id, files, notes, error, error_code, created_at, finished_at")
      .eq("org_id", orgId).eq("ad_id", adId).order("created_at", { ascending: false }).limit(10),
    supabase.from("scenes").select("id, idx, copy").eq("org_id", orgId).eq("ad_id", adId).order("idx"),
  ]);
  if (error) return { ok: false, error: "Could not load Auto-edit." };

  // Signed URLs (renders is a private bucket), with the service client after the access check above.
  const service = createServiceClient();
  const { data: assets } = await service.from("assets")
    .select("id, kind, scene_id, version, storage_path, source, meta, created_at")
    .eq("org_id", orgId).eq("ad_id", adId).eq("archived", false).in("kind", ["video", "vo", "final", "broll"]);
  const rows = assets ?? [];
  const videos = latestByScene(rows, "video");
  const vos = latestByScene(rows, "vo");
  const finalPath = new Map(rows.filter((r) => r.kind === "final").map((r) => [r.id, r.storage_path]));
  const exportPaths = (renders ?? []).flatMap((r) => (r.status === "succeeded" ? ((r.files ?? []) as { storagePath: string }[]).map((f) => f.storagePath) : []));
  const uploads = rows
    .filter((r) => r.kind === "broll" && typeof (r.meta as { clipIndex?: unknown } | null)?.clipIndex === "number")
    .map((r) => ({ row: r, meta: r.meta as { clipIndex: number; name?: string; duration?: number } }))
    .sort((a, b) => a.meta.clipIndex - b.meta.clipIndex);
  const scenePaths = [...videos.values(), ...vos.values(), ...uploads.map((u) => u.row)].map((r) => r.storage_path);
  const toSign = [...new Set([...scenePaths, ...exportPaths])];
  const signed = new Map<string, string>();
  if (toSign.length) {
    const { data: urls } = await service.storage.from("renders").createSignedUrls(toSign, 3600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const signOne = async (path: string | undefined, download?: string) => {
    if (!path) return null;
    const { data } = await service.storage.from("renders").createSignedUrl(path, 3600, download ? { download } : undefined);
    return data?.signedUrl ?? null;
  };

  const runViews: AutoEditRunView[] = [];
  for (const r of runs ?? []) {
    const graphics = (r.graphics ?? []) as { id: string; fallback?: string | null }[];
    const review = r.review as { verdict: "ship" | "fix"; issues: ReviewIssue[] } | null;
    runViews.push({
      id: r.id, kind: r.kind, mode: r.mode, status: r.status, instruction: r.instruction,
      summary: (r.plan as { summary?: string } | null)?.summary ?? null,
      reviewVerdict: review?.verdict ?? null, reviewIssues: review?.issues ?? [],
      fallbacks: graphics.filter((g) => g.fallback).map((g) => ({ id: g.id, reason: g.fallback! })),
      claudeUsd: Number(r.claude_usd ?? 0),
      error: r.status === "failed" ? r.error || autoEditErrorMessage(r.error_code) : r.error,
      createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
      queuePosition: r.status === "queued" ? ((await supabase.rpc("auto_edit_queue_position", { target_run_id: r.id })).data as number | null) : null,
    });
  }

  const renderViews: RenderView[] = [];
  for (const r of renders ?? []) {
    const path = r.asset_id ? finalPath.get(r.asset_id) : undefined;
    renderViews.push({
      id: r.id, kind: r.kind, format: r.format, status: r.status, timelineVersion: r.timeline_version,
      error: r.status === "failed" ? r.error || autoEditErrorMessage(r.error_code) : r.error,
      notes: (r.notes ?? []) as string[], createdAt: r.created_at, finishedAt: r.finished_at,
      videoUrl: path ? signed.get(path) ?? (await signOne(path)) : null,
      downloadUrl: path ? await signOne(path, `autocut-${adId.slice(0, 8)}.mp4`) : null,
      files: r.status === "succeeded"
        ? ((r.files ?? []) as { path: string; storagePath: string; bytes: number }[]).flatMap((f) => (signed.get(f.storagePath) ? [{ path: f.path, url: signed.get(f.storagePath)!, bytes: f.bytes }] : []))
        : [],
    });
  }

  const editorScenes: EditorScene[] = (scenes ?? []).map((s) => {
    const video = videos.get(s.id);
    const vo = vos.get(s.id);
    return {
      index: s.idx,
      copy: s.copy ?? "",
      videoUrl: video ? signed.get(video.storage_path) ?? null : null,
      voiceoverUrl: vo ? signed.get(vo.storage_path) ?? null : null,
      voiceoverMode: vo && video ? voiceoverMode(video, vo) : null,
    };
  });

  for (const { row, meta } of uploads) {
    editorScenes.push({
      index: meta.clipIndex, copy: "", videoUrl: signed.get(row.storage_path) ?? null, voiceoverUrl: null, voiceoverMode: null,
      upload: { assetId: row.id, name: meta.name ?? "Clip", duration: Number(meta.duration ?? 0) },
    });
  }

  return {
    ok: true,
    defaultMode: (brand?.auto_edit_mode as AutoEditMode | null | undefined) ?? "designed",
    runs: runViews,
    timeline: timeline
      ? {
          plan: timeline.plan as EditPlan,
          version: timeline.version,
          mode: timeline.mode,
          findings: (timeline.findings ?? []) as ReviewIssue[],
          clipDurations: Object.fromEntries(Object.entries((timeline.clip_durations ?? {}) as Record<string, number>).map(([k, v]) => [Number(k), Number(v)])),
          sourceRunId: timeline.source_run_id,
          updatedAt: timeline.updated_at,
        }
      : null,
    scenes: editorScenes,
    renders: renderViews,
  };
}
