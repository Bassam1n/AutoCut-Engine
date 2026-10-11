"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "../../brands-actions";

export function ArchiveBrandButton({
  orgId,
  onArchive,
}: {
  orgId: string;
  onArchive: () => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onArchive();
      if (result.ok) {
        router.push(`/org/${orgId}/brands`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="self-start text-sm font-medium text-danger hover:underline disabled:opacity-60"
      >
        {confirming ? "Click again to confirm archiving this brand" : "Archive this brand"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
