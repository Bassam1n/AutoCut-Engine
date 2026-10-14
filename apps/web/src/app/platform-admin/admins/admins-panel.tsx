"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import type { PlatformAdmin } from "../data";
import { addPlatformAdmin, revokePlatformAdmin } from "../agency-actions";

export function AdminsPanel({ admins, currentUserId }: { admins: PlatformAdmin[]; currentUserId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<PlatformAdmin | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addPlatformAdmin(email.trim());
      if (!result.ok) return setError(result.error);
      setEmail("");
      router.refresh();
    });
  }

  function revoke(admin: PlatformAdmin) {
    setError(null);
    startTransition(async () => {
      const result = await revokePlatformAdmin(admin.user_id);
      if (!result.ok) setError(result.error);
      setRevoking(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Add a platform admin</h2>
        <p className="text-xs text-foreground-muted">They need an AutoCut account already. They get full access to every agency.</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="field min-w-0 flex-1"
          />
          <button type="submit" className="btn-primary" disabled={isPending}>
            Add admin
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>

      <ul className="card divide-y divide-border">
        {admins.map((a) => (
          <li key={a.user_id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {a.email}
                {a.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-foreground-muted">You</span>}
              </span>
              <span className="block text-xs text-foreground-muted">Admin since {new Date(a.created_at).toLocaleDateString()}</span>
            </div>
            {a.user_id !== currentUserId && (
              <button type="button" className="btn-ghost btn-xs" onClick={() => setRevoking(a)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {revoking && (
        <Modal title="Revoke platform access?" onClose={() => setRevoking(null)}>
          <p className="text-sm text-foreground-muted">
            {revoking.email} will lose access to the platform dashboard. Their own agency memberships stay as they are.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger btn-sm" disabled={isPending} onClick={() => revoke(revoking)}>
              Revoke access
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
