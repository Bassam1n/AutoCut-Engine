"use client";

import { useState, useTransition } from "react";
import type { Customer } from "./customers-data";
import { createCustomer, updateCustomer } from "./customers-actions";
import { buttonVariants } from "@/components/button";

export function CustomerScreen({
  orgId,
  brandId,
  customers,
}: {
  orgId: string;
  brandId: string;
  customers: Customer[];
}) {
  const [showNewForm, setShowNewForm] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {customers.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No audience profiles yet. Add one or two so briefs can say
          &quot;make it for [name]&quot; without re-asking.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {customers.map((customer) => (
            <CustomerCard key={customer.id} orgId={orgId} brandId={brandId} customer={customer} />
          ))}
        </div>
      )}

      {customers.length >= 2 && !showNewForm && (
        <p className="text-xs text-foreground-muted">
          Most brands only need one or two profiles, but you can add more
          if needed.
        </p>
      )}

      {showNewForm ? (
        <NewCustomerForm
          orgId={orgId}
          brandId={brandId}
          onDone={() => setShowNewForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          className={`self-start ${buttonVariants.primary}`}
        >
          Add audience profile
        </button>
      )}
    </div>
  );
}

function CustomerCard({
  orgId,
  brandId,
  customer,
}: {
  orgId: string;
  brandId: string;
  customer: Customer;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isEditing) {
    return (
      <div className="rounded-xl border border-border bg-background-raised p-4">
        <CustomerForm
          defaultValues={customer}
          submitLabel="Save"
          onCancel={() => setIsEditing(false)}
          onSubmit={(formData) => {
            setError(null);
            return new Promise((resolve) => {
              startTransition(async () => {
                const result = await updateCustomer(orgId, brandId, customer.id, formData);
                if (result.ok) setIsEditing(false);
                else setError(result.error);
                resolve(result);
              });
            });
          }}
          disabled={isPending}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background-raised p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{customer.name}</p>
          {customer.profile.age_range && (
            <p className="mt-0.5 text-xs text-foreground-muted">
              {customer.profile.age_range}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs font-medium text-accent hover:underline"
        >
          Edit
        </button>
      </div>
      {customer.profile.pains && (
        <p className="mt-2 text-sm">
          <span className="text-foreground-muted">Pains: </span>
          {customer.profile.pains}
        </p>
      )}
      {customer.profile.desired_outcome && (
        <p className="mt-1 text-sm">
          <span className="text-foreground-muted">Wants: </span>
          {customer.profile.desired_outcome}
        </p>
      )}
    </div>
  );
}

function NewCustomerForm({
  orgId,
  brandId,
  onDone,
}: {
  orgId: string;
  brandId: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border bg-background-raised p-4">
      <CustomerForm
        submitLabel="Add"
        onCancel={onDone}
        disabled={isPending}
        onSubmit={(formData) => {
          setError(null);
          return new Promise((resolve) => {
            startTransition(async () => {
              const result = await createCustomer(orgId, brandId, formData);
              if (result.ok) onDone();
              else setError(result.error);
              resolve(result);
            });
          });
        }}
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function CustomerForm({
  defaultValues,
  submitLabel,
  disabled,
  onSubmit,
  onCancel,
}: {
  defaultValues?: Customer;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  function handleSubmit(formData: FormData) {
    onSubmit(formData);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaultValues?.name}
          disabled={disabled}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="age_range" className="text-sm font-medium">
          Age range
        </label>
        <input
          id="age_range"
          name="age_range"
          placeholder="e.g. 25-34"
          defaultValue={defaultValues?.profile.age_range ?? ""}
          disabled={disabled}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pains" className="text-sm font-medium">
          Pains, in their words
        </label>
        <textarea
          id="pains"
          name="pains"
          rows={2}
          defaultValue={defaultValues?.profile.pains ?? ""}
          disabled={disabled}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="desired_outcome" className="text-sm font-medium">
          Desired outcome
        </label>
        <textarea
          id="desired_outcome"
          name="desired_outcome"
          rows={2}
          defaultValue={defaultValues?.profile.desired_outcome ?? ""}
          disabled={disabled}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled}
          className={buttonVariants.primary}
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
