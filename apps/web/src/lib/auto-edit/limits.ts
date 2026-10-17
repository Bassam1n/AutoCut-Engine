import type { MachinePresetName } from "@trigger.dev/core/v3";

/**
 * Render capacity for Auto-edit. All three are read when the tasks are
 * deployed (Trigger.dev registers limits at deploy), so to change them
 * either edit the defaults here and push, or set the variables in the
 * deploy workflow's environment.
 *
 * Without a deploy, the Trigger.dev dashboard (Limits) or the SDK can
 * override a running limit:
 *   await concurrencyLimits.override("auto-edit-render", { perKey: 4, total: 20 })
 *
 * - perAgency: renders one agency (org) can have executing at once.
 * - total: renders executing across every agency. 2 while on the
 *   Trigger.dev free plan; raise it with the plan at launch.
 * Runs over either limit wait in the queue and show "Queued" in the app.
 */
export const AUTO_EDIT_LIMIT_NAME = "auto-edit-render";

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const AUTO_EDIT_PER_AGENCY_LIMIT = positiveInt(process.env.AUTO_EDIT_PER_AGENCY_LIMIT, 2);
export const AUTO_EDIT_TOTAL_LIMIT = positiveInt(process.env.AUTO_EDIT_TOTAL_LIMIT, 2);

/** 4 vCPU / 8 GB. The final 1080x1920 export is CPU-bound; 8 GB lets two graphics render side by side. */
export const AUTO_EDIT_MACHINE = (process.env.AUTO_EDIT_MACHINE ?? "large-1x") as MachinePresetName;
