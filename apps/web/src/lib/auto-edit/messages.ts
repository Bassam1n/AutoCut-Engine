/**
 * Plain-language text for Auto-edit's states and failures, shared by
 * the worker (which stores the message on the run) and the export
 * step UI. Same idea as spend-limit-message.ts: an editor never sees a
 * raw engine or API error.
 */

export const AUTO_EDIT_STATUSES = [
  "queued", "planning", "rendering_preview", "reviewing", "fixing", "rendering_final", "succeeded", "failed", "cancelled",
] as const;
export type AutoEditStatus = (typeof AUTO_EDIT_STATUSES)[number];

export const STATUS_LABEL: Record<AutoEditStatus, string> = {
  queued: "Queued",
  planning: "Planning the edit",
  rendering_preview: "Rendering a preview",
  reviewing: "Reviewing the preview",
  fixing: "Fixing what the review found",
  rendering_final: "Rendering the final video",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function isActiveStatus(s: string): boolean {
  return !["succeeded", "failed", "cancelled"].includes(s);
}

export type AutoEditErrorCode =
  | "SPEND_LIMIT" | "KEY_INVALID" | "KEY_NO_CREDIT" | "RATE_LIMIT" | "TIMEOUT" | "NEEDS_HUMAN"
  | "VALIDATION" | "PROVIDER_ERROR" | "AD_NOT_READY" | "RENDER_FAILED" | "INTERNAL";

/** The message an editor sees for a failed run. `detail` is already plain language for SPEND_LIMIT and AD_NOT_READY. */
export function autoEditErrorMessage(code: string | null | undefined, detail?: string | null): string {
  switch (code) {
    case "SPEND_LIMIT":
    case "AD_NOT_READY":
    case "NEEDS_HUMAN":
      return detail || "Auto-edit could not start.";
    case "KEY_INVALID":
      return "The Anthropic key for this brand or agency is missing or invalid. An owner or admin can update it in Settings → API keys.";
    case "KEY_NO_CREDIT":
      return "The agency's Anthropic account is out of credit. Top it up in the Anthropic console, then try again.";
    case "RATE_LIMIT":
      return "Anthropic is rate limiting this agency's key right now. Wait a minute and try again.";
    case "TIMEOUT":
      return "Auto-edit could not reach Anthropic. Try again in a moment.";
    case "VALIDATION":
      return "Claude's edit didn't pass our checks twice in a row. Try again; if it keeps happening, try the other mode.";
    case "RENDER_FAILED":
      return "The video render failed. Nothing was charged for the render; try again, and if it fails again let us know.";
    case "PROVIDER_ERROR":
      return "Anthropic returned an error. Try again in a moment.";
    default:
      return "Something went wrong with this Auto-edit. Try again; if it fails again let us know.";
  }
}
