"use client";

import { useState, useTransition } from "react";
import { saveSlackWebhook } from "./slack-actions";

/**
 * Slack incoming webhook for review notifications. The URL is stored in
 * Vault and never sent back to the browser, so once saved we only show
 * "Connected".
 */
export function SlackSettings({ orgId, connected }: { orgId: string; connected: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(!connected);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function save(nextUrl: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await saveSlackWebhook(orgId, nextUrl);
      if (result.ok) {
        setUrl("");
        setEditing(!nextUrl);
        setMessage({ kind: "ok", text: nextUrl ? "Connected. A test message was sent to Slack." : "Slack disconnected." });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Slack notifications</h2>
          <p className="mt-0.5 text-xs text-foreground-muted">
            Posts to a channel when a task is ready for review, needs changes, or is approved.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            connected ? "bg-accent-soft text-accent" : "border border-border text-foreground-muted"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(url);
          }}
        >
          <div className="flex gap-2">
            <input
              type="url"
              required
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isPending}
              aria-label="Slack incoming webhook URL"
              className="field flex-1"
            />
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="text-xs text-foreground-muted">
            In Slack, add the Incoming Webhooks app to a channel and paste its URL here.
          </p>
        </form>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} disabled={isPending} className="btn-secondary btn-sm">
            Change webhook
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Disconnect Slack? Notifications will stop posting there.")) save("");
            }}
            disabled={isPending}
            className="btn-ghost btn-sm text-danger"
          >
            Disconnect
          </button>
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-accent" : "text-danger"}`}>{message.text}</p>
      )}
    </div>
  );
}
