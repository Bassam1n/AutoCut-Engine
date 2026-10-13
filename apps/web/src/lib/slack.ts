import "server-only";
import { createServiceClient } from "./supabase/service";

/**
 * Posts a message to the org's Slack incoming webhook, if one is
 * connected (Org-wide keys > Slack). Best effort: a missing webhook or a
 * Slack outage never fails the action that triggered it, since the
 * in-app notification is written by the database either way.
 */
export async function postToSlack(orgId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const service = createServiceClient();
    const { data: url } = await service.rpc("get_slack_webhook", { target_org_id: orgId });
    if (!url) return { ok: false, error: "Slack isn't connected." };

    const res = await fetch(url as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { ok: false, error: `Slack returned ${res.status}.` };
    return { ok: true };
  } catch (err) {
    console.error("postToSlack failed", err);
    return { ok: false, error: "Couldn't reach Slack." };
  }
}

/** Absolute URL for a path inside the app, for links in Slack messages. */
export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}
