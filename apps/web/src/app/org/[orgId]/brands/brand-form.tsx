"use client";

import { useState, useTransition } from "react";
import type { Brand } from "./brands-data";
import type { ActionResult } from "./brands-actions";
import { buttonVariants } from "@/components/button";
import type { AssignableUser } from "./assignment-data";

const CONTEXT_FIELDS = [
  { key: "audience", label: "Audience", placeholder: "Who this brand speaks to" },
  { key: "tone", label: "Tone", placeholder: "How the brand sounds — e.g. warm, direct, playful" },
  { key: "product_facts", label: "Product facts", placeholder: "What's true about the products that should never be misstated" },
  { key: "visual_feel", label: "Visual feel", placeholder: "Colors, lighting, mood — described positively" },
  { key: "never_generate", label: "Never generate", placeholder: "Describe what the frame SHOULD contain instead of listing banned items — image models draw whatever a 'no ___' list names" },
  { key: "claims_rules", label: "Claims rules", placeholder: "What can and can't be claimed about the product" },
] as const;

export function BrandForm({
  brand,
  onSubmit,
  submitLabel,
  assignees,
}: {
  brand?: Brand;
  onSubmit: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  /** Owners/admins only: users who can be assigned, and who already are. */
  assignees?: { users: AssignableUser[]; selectedIds: string[] };
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
    <form action={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Brand name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={brand?.name}
          disabled={isPending}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="logo_url" className="text-sm font-medium">
          Logo URL
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">
            optional
          </span>
        </label>
        <input
          id="logo_url"
          name="logo_url"
          type="url"
          defaultValue={brand?.logo_url ?? ""}
          disabled={isPending}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Brand context</p>
        {CONTEXT_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label htmlFor={field.key} className="text-sm">
              {field.label}
            </label>
            <textarea
              id={field.key}
              name={field.key}
              rows={2}
              placeholder={field.placeholder}
              defaultValue={brand?.brand_context?.[field.key] ?? ""}
              disabled={isPending}
              className="field resize-none"
            />
          </div>
        ))}
      </div>

      {assignees && (
        <fieldset className="card-inset flex flex-col gap-2 p-4">
          <legend className="sr-only">Assigned users</legend>
          <input type="hidden" name="assignees_present" value="1" />
          <p className="text-sm font-medium">Assigned users</p>
          <p className="text-xs text-foreground-muted">
            Users only see the brands assigned to them. Owners and admins see every brand.
          </p>
          {assignees.users.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              No users on the team yet. Invite one from the Team page.
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              {assignees.users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="assignee_ids"
                    value={u.id}
                    defaultChecked={assignees.selectedIds.includes(u.id)}
                    disabled={isPending}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span>{u.name?.trim() || u.email}</span>
                  {u.name?.trim() && (
                    <span className="text-xs text-foreground-muted">{u.email}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className={`self-start ${buttonVariants.primary}`}
      >
        {submitLabel}
      </button>
    </form>
  );
}
