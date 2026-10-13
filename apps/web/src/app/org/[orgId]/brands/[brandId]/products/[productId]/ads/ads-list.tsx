"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { renameAd, archiveAd, unarchiveAd, duplicateAd } from "./ads-actions";
import { Modal } from "@/components/modal";
import type { Ad } from "./ads-data";

export function AdsList({
  orgId,
  brandId,
  productId,
  ads,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ads: Ad[];
}) {
  const [showArchived, setShowArchived] = useState(false);
  const visible = ads.filter((ad) => (showArchived ? ad.archived : !ad.archived));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link
          href={`/org/${orgId}/brands/${brandId}/products/${productId}/ads/new`}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          New ad
        </Link>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="text-xs font-medium text-foreground-muted hover:underline"
        >
          {showArchived ? "Show active ads" : "Show archived ads"}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {showArchived ? "No archived ads." : "No ads yet for this product."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((ad) => (
            <AdRow key={ad.id} orgId={orgId} brandId={brandId} productId={productId} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdRow({
  orgId,
  brandId,
  productId,
  ad,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const displayName = ad.name || ad.brief.hooks?.[0] || ad.brief.idea || "Untitled ad";

  function onArchiveToggle(e: React.MouseEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = ad.archived
        ? await unarchiveAd(orgId, brandId, productId, ad.id)
        : await archiveAd(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  function onRenameClick(e: React.MouseEvent) {
    e.preventDefault();
    setIsRenaming(true);
  }

  function onDuplicate(e: React.MouseEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // duplicateAd redirects on success, so a resolved { ok: false }
      // here always means the duplicate actually failed.
      const result = await duplicateAd(orgId, brandId, productId, ad.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/org/${orgId}/brands/${brandId}/products/${productId}/ads/${ad.id}`}
        className="flex items-center justify-between rounded-xl border border-border bg-background-raised p-4 transition-colors hover:border-border-strong"
      >
        <div>
          <p className="font-medium">{displayName}</p>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {new Date(ad.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium capitalize text-accent">
            {ad.status}
          </span>
          <button
            type="button"
            onClick={onRenameClick}
            className="rounded-lg border border-border-strong px-2 py-1 text-xs font-medium hover:bg-border/40"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onArchiveToggle}
            disabled={isPending}
            className="rounded-lg border border-border-strong px-2 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
          >
            {ad.archived ? "Unarchive" : "Archive"}
          </button>
        </div>
      </Link>
      {error && <p className="text-xs text-danger">{error}</p>}
      {isRenaming && (
        <RenameModal
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          ad={ad}
          onClose={() => setIsRenaming(false)}
        />
      )}
    </div>
  );
}

function RenameModal({
  orgId,
  brandId,
  productId,
  ad,
  onClose,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  onClose: () => void;
}) {
  const [name, setName] = useState(ad.name ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await renameAd(orgId, brandId, productId, ad.id, name);
      if (result.ok) {
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal title="Rename ad" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ad name"
          autoFocus
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}
