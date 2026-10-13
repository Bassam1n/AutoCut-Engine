"use client";

import { useState, useTransition } from "react";
import type { Style } from "@/app/org/[orgId]/styles/styles-data";
import { createAd } from "../ads-actions";
import { buttonVariants } from "@/components/button";

export function NewAdForm({
  orgId,
  brandId,
  productId,
  styles,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  styles: Style[];
}) {
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createAd(orgId, brandId, productId, selectedStyleId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {styles.map((style) => {
          const isSelected = selectedStyleId === style.id;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => setSelectedStyleId(style.id)}
              className={`flex flex-col overflow-hidden rounded-xl border text-left transition-colors ${
                isSelected
                  ? "border-accent ring-2 ring-accent"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <div className="relative aspect-[4/5] w-full overflow-hidden bg-accent-soft">
                {style.preview_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={style.preview_image_url}
                    alt={style.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-accent">
                    {style.name}
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium">{style.name}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={onCreate}
        disabled={!selectedStyleId || isPending}
        className={`self-start ${buttonVariants.primary}`}
      >
        {isPending ? "Creating..." : "Start this ad"}
      </button>
    </div>
  );
}
