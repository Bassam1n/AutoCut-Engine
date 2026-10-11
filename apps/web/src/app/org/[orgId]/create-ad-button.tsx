"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { listBrandsForPicker, listProductsForPicker } from "./create-ad-actions";
import type { Brand } from "./brands/brands-data";
import type { Product } from "./brands/[brandId]/products/products-data";

/**
 * Sidebar shortcut for creating an ad without navigating brand ->
 * product -> ads -> new by hand. Picks a brand, then a product under
 * it, then redirects to the existing new-ad style-picker page —
 * reuses the ad creation pipeline exactly as it already exists,
 * rather than building a second one.
 */
export function CreateAdButton({ orgId }: { orgId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        + Create ad
      </button>
      {isOpen && <CreateAdModal orgId={orgId} onClose={() => setIsOpen(false)} />}
    </>
  );
}

function CreateAdModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    setSelectedBrand(brand);
    setError(null);
    startTransition(async () => {
      try {
        setProducts(await listProductsForPicker(orgId, brand.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load products.");
      }
    });
  }

  function onPickProduct(product: Product) {
    if (!selectedBrand) return;
    router.push(`/org/${orgId}/brands/${selectedBrand.id}/products/${product.id}/ads/new`);
    onClose();
  }

  return (
    <Modal title={selectedBrand ? `New ad for ${selectedBrand.name}` : "New ad — pick a brand"} onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}

      {!selectedBrand ? (
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
      ) : (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setSelectedBrand(null);
              setProducts(null);
            }}
            className="mb-1 self-start text-xs font-medium text-foreground-muted hover:underline"
          >
            ← Back to brands
          </button>
          {products === null || isPending ? (
            <p className="text-sm text-foreground-muted">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              No products yet for this brand — create one first.
            </p>
          ) : (
            products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onPickProduct(product)}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-border/40"
              >
                {product.name}
              </button>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
