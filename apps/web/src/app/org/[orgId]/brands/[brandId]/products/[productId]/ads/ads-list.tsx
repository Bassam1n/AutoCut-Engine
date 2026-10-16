"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { renameAd, archiveAd, unarchiveAd, duplicateAd, deleteAdPermanently } from "./ads-actions";
import { Modal } from "@/components/modal";
import type { Ad } from "./ads-data";
import { buttonVariants } from "@/components/button";

export function AdsList({
  orgId,
  brandId,
  productId,
  ads,
  canCreate,
  canDelete,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ads: Ad[];
  /** member_can_create_ads(): hides New ad and Duplicate when false. */
  canCreate: boolean;
  /** Owner only: permanent delete on archived ads. */
  canDelete: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const visible = ads.filter((ad) => (showArchived ? ad.archived : !ad.archived));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {canCreate ? (
          <Link
            href={`/org/${orgId}/brands/${brandId}/products/${productId}/ads/new`}
            className={`self-start ${buttonVariants.primary}`}
          >
            New ad
          </Link>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="text-xs font-medium text-foreground-muted hover:underline"
        >
          {showArchived ? "Show active ads" : "Show archived ads"}
        </button>
      </div>

      {showArchived && visible.length > 0 && (
        <p className="text-xs text-foreground-muted">
          Archived ads keep their text, but their images and videos are deleted 90 days after archiving, except anything
          saved to the Library.{canDelete ? " Delete permanently to free the space now." : ""}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {showArchived ? "No archived ads." : "No ads yet for this product."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((ad) => (
            <AdRow
              key={ad.id}
              orgId={orgId}
              brandId={brandId}
              productId={productId}
              ad={ad}
              canDuplicate={canCreate}
              canDelete={canDelete}
            />
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
  canDuplicate,
  canDelete,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  canDuplicate: boolean;
  canDelete: boolean;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
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
        className="card card-interactive flex items-center justify-between p-4"
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
            className="btn-secondary btn-sm"
          >
            Rename
          </button>
          {canDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              disabled={isPending}
              className="btn-secondary btn-sm"
            >
              Duplicate
            </button>
          )}
          <button
            type="button"
            onClick={onArchiveToggle}
            disabled={isPending}
            className="btn-secondary btn-sm"
          >
            {ad.archived ? "Unarchive" : "Archive"}
          </button>
          {ad.archived && canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setIsDeleting(true);
              }}
              disabled={isPending}
              className="btn-secondary btn-sm text-danger"
            >
              Delete permanently
            </button>
          )}
        </div>
      </Link>
      {error && <p className="text-xs text-danger">{error}</p>}
      {isDeleting && (
        <DeleteModal
          orgId={orgId}
          brandId={brandId}
          productId={productId}
          ad={ad}
          displayName={displayName}
          onClose={() => setIsDeleting(false)}
        />
      )}
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
          className="field"
        />
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary btn-sm self-start"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

function DeleteModal({
  orgId,
  brandId,
  productId,
  ad,
  displayName,
  onClose,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  ad: Ad;
  displayName: string;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ready = confirmText.trim().toLowerCase() === "delete";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAdPermanently(orgId, brandId, productId, ad.id);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Modal title="Delete ad permanently" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="text-sm">
          <span className="font-medium">{displayName}</span> and everything in it will be deleted: scripts, storyboard,
          images, videos, voiceovers and any Library items saved from it. This can&apos;t be undone.
        </p>
        <p className="text-xs text-foreground-muted">Spend history and board tasks are kept.</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Type DELETE to confirm</span>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus disabled={isPending} className="field" />
        </label>
        <button type="submit" disabled={!ready || isPending} className="btn-primary btn-sm self-start bg-danger">
          {isPending ? "Deleting..." : "Delete permanently"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}
