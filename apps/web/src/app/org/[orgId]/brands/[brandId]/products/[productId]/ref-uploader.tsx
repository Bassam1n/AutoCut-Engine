"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProductRef } from "../products-data";
import { reserveProductRefPath, recordProductRef } from "../products-actions";

const KINDS = ["photo", "angle", "alternate"] as const;

export function RefUploader({
  orgId,
  brandId,
  productId,
  refs,
  signedUrls,
}: {
  orgId: string;
  brandId: string;
  productId: string;
  refs: ProductRef[];
  signedUrls: Record<string, string>;
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("photo");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const reserved = await reserveProductRefPath(orgId, productId, file.name);
      if (!reserved.ok) {
        setError(reserved.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("refs")
        .upload(reserved.path, file, { upsert: false });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const result = await recordProductRef(
        orgId,
        brandId,
        productId,
        kind,
        file.name,
        reserved.path
      );

      if (!result.ok) {
        setError(result.error);
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const byKind = {
    photo: refs.filter((r) => r.kind === "photo"),
    angle: refs.filter((r) => r.kind === "angle"),
    alternate: refs.filter((r) => r.kind === "alternate"),
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
          disabled={uploading}
          className="rounded-lg border border-border-strong bg-background px-2 py-2 text-sm capitalize outline-none disabled:opacity-60"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${
            uploading
              ? "cursor-not-allowed bg-accent/60 text-accent-ink opacity-60"
              : "cursor-pointer bg-accent text-accent-ink hover:opacity-90"
          }`}
        >
          {uploading ? "Uploading..." : "Upload image"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {KINDS.map((k) => (
        <RefSection key={k} kind={k} refs={byKind[k]} signedUrls={signedUrls} />
      ))}
    </div>
  );
}

function RefSection({
  kind,
  refs,
  signedUrls,
}: {
  kind: (typeof KINDS)[number];
  refs: ProductRef[];
  signedUrls: Record<string, string>;
}) {
  if (refs.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium capitalize text-foreground-muted">
        {kind}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {refs.map((ref) => {
          const url = signedUrls[ref.storage_path];
          return (
            <div
              key={ref.id}
              className="aspect-square overflow-hidden rounded-lg border border-border bg-background"
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={ref.name ?? kind}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-foreground-muted">
                  No preview
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
