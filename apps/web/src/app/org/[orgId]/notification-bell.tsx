"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listMyNotifications, markNotificationsRead, type NotificationItem } from "./notifications-actions";
import { sameOriginPath } from "@/lib/safe-next";

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * In-app notifications (review requested, changes requested, approved).
 * Rows are written by the database when a task changes stage
 * (migration 57); the list loads when the panel opens.
 */
export function NotificationBell({ orgId, unreadCount }: { orgId: string; unreadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(null);
      startTransition(async () => setItems(await listMyNotifications(orgId)));
    }
  }

  function openItem(item: NotificationItem) {
    setOpen(false);
    startTransition(async () => {
      if (!item.read_at) await markNotificationsRead(orgId, [item.id]);
      // Stored links are only ever followed within the app.
      const link = sameOriginPath(item.link, window.location.origin);
      if (link) router.push(link);
    });
  }

  function markAll() {
    setItems((list) => list?.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })) ?? null);
    startTransition(async () => {
      await markNotificationsRead(orgId, null);
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="btn-ghost relative h-8 w-8 p-0"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        // Fixed just right of the sidebar: the sidebar scrolls (overflow-y-auto), which would clip an absolute panel.
        <div className="card fixed left-[17.5rem] top-4 z-40 flex w-80 flex-col overflow-hidden text-foreground">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {items && items.some((i) => !i.read_at) && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-foreground-muted">Loading...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-foreground-muted">You&apos;re all caught up.</p>
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-border/40"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read_at ? "bg-transparent" : "bg-accent"}`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className={`text-sm ${item.read_at ? "text-foreground-muted" : "font-medium"}`}>{item.title}</span>
                        {item.body && <span className="text-xs text-foreground-muted">{item.body}</span>}
                        <span className="mt-0.5 text-[11px] text-foreground-muted">{timeAgo(item.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
