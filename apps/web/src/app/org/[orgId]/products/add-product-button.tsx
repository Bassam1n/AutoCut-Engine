"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { listBrandsForPicker } from "../create-ad-actions";
import type { Brand } from "../brands/brands-data";
import { buttonVariants } from "@/components/button";

/** Picks a brand first, then redirects to the existing new-product form for it. */
export function AddProductButton({ orgId }: { orgId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`self-start ${buttonVariants.primary}`}
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

  useEffect(() => {
    let cancelled = false;
    listBrandsForPicker(orgId)
      .then((result) => {
        if (!cancelled) setBrands(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load brands.");
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  function onPickBrand(brand: Brand) {
    router.push(`/org/${orgId}/brands/${brand.id}/products/new`);
    onClose();
  }

  return (
    <Modal title="New product — pick a brand" onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-col gap-1">
        {brands === null ? (
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
