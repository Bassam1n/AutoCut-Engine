"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { listBrandsForPicker } from "../create-ad-actions";
import type { Brand } from "../brands/brands-data";

/** Picks a brand first, then redirects to the existing new-product form for it. */
export function AddProductButton({ orgId }: { orgId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        New product
      </button>
      {isOpen && <PickBrandModal orgId={orgId} onClose={() => setIsOpen(false)} />}
    </>
  );
}

function PickBrandModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (brands === null) {
    startTransition(async () => {
      try {
        setBrands(await listBrandsForPicker(orgId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load brands.");
      }
    });
  }

  function onPickBrand(brand: Brand) {
    router.push(`/org/${orgId}/brands/${brand.id}/products/new`);
    onClose();
  }

  return (
    <Modal title="New product — pick a brand" onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-col gap-1">
        {brands === null || isPending ? (
          <p className="text-sm text-foreground-muted">Loading brands...</p>
        ) : brands.length === 0 ? (
          <p className="text-sm text-foreground-muted">No brands yet — create one first.</p>
        ) : (
          brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              onClick={() => onPickBrand(brand)}
              className="rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-border/40"
            >
              {brand.name}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
