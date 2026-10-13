"use client";

import { useState, useTransition } from "react";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS } from "./product-categories";
import type { Product } from "./products-data";
import type { ActionResult } from "./products-actions";
import { buttonVariants } from "@/components/button";

export function ProductForm({
  product,
  onSubmit,
  submitLabel,
  readOnly = false,
}: {
  product?: Product;
  onSubmit: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  /** View-only for users without product editing access (migration 53). */
  readOnly?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const busy = isPending || readOnly;
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Product name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={product?.name}
          disabled={busy}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="category" className="text-sm font-medium">
          Category
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">
            optional
          </span>
        </label>
        <select
          id="category"
          name="category"
          defaultValue={product?.category ?? ""}
          disabled={busy}
          className="field"
        >
          <option value="">Select a category</option>
          {PRODUCT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {PRODUCT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <p className="text-xs text-foreground-muted">
          Used to pick tone and angle guidance when generating ad scripts.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="what_it_is" className="text-sm font-medium">
          What it is
        </label>
        <input
          id="what_it_is"
          name="what_it_is"
          placeholder="One line describing the product"
          defaultValue={product?.what_it_is ?? ""}
          disabled={busy}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="real_world_size" className="text-sm font-medium">
          Real-world size
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">
            optional
          </span>
        </label>
        <input
          id="real_world_size"
          name="real_world_size"
          placeholder={'e.g. "15cm tall, 8cm wide" or "about the size of a soda can"'}
          defaultValue={product?.real_world_size ?? ""}
          disabled={busy}
          className="field"
        />
        <p className="text-xs text-foreground-muted">
          Helps generated images and videos show the product at the right scale.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="url" className="text-sm font-medium">
          Product URL
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">
            optional
          </span>
        </label>
        <input
          id="url"
          name="url"
          type="url"
          defaultValue={product?.url ?? ""}
          disabled={busy}
          className="field"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!readOnly && (
        <button
          type="submit"
          disabled={busy}
          className={`self-start ${buttonVariants.primary}`}
        >
          {submitLabel}
        </button>
      )}
    </form>
  );
}
