"use client";

import { useState, useTransition } from "react";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS } from "./product-categories";
import type { Product } from "./products-data";
import type { ActionResult } from "./products-actions";

export function ProductForm({
  product,
  onSubmit,
  submitLabel,
}: {
  product?: Product;
  onSubmit: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
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
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
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
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
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
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
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
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  );
}
