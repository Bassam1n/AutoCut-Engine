"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { AsyncButton } from "@/components/async-button";
import {
  createBrandCastMember,
  updateBrandCastMember,
  deactivateBrandCastMember,
  reserveBrandCastUploadPath,
  recordBrandCastUpload,
} from "./cast-library-actions";
import type { BrandCastMemberRow } from "./cast-library-data";

export function CastLibraryPanel({
  orgId,
  brandId,
  members,
  assetUrls,
}: {
  orgId: string;
  brandId: string;
  members: BrandCastMemberRow[];
  assetUrls: Record<string, string>;
}) {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {isCreating ? (
        <CreateForm orgId={orgId} brandId={brandId} onClose={() => setIsCreating(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          New cast member
        </button>
      )}

      {members.filter((m) => m.active).length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No cast members yet. Create one here, or save one from an ad&apos;s Concept &amp; cast
          step.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {members
            .filter((m) => m.active)
            .map((member) => (
              <MemberCard key={member.id} orgId={orgId} brandId={brandId} member={member} assetUrls={assetUrls} />
            ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({
  orgId,
  brandId,
  onClose,
}: {
  orgId: string;
  brandId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createBrandCastMember(orgId, brandId, name, description);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          Description
          <span className="ml-1.5 text-xs font-normal text-foreground-muted">optional</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          rows={2}
          className="resize-none rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <AsyncButton
          onClick={onSubmit}
          isPending={isPending}
          pendingLabel="Saving..."
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Create
        </AsyncButton>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MemberCard({
  orgId,
  brandId,
  member,
  assetUrls,
}: {
  orgId: string;
  brandId: string;
  member: BrandCastMemberRow;
  assetUrls: Record<string, string>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [description, setDescription] = useState(member.description ?? "");
  const [isSaving, startSaving] = useTransition();
  const [isDeactivating, startDeactivating] = useTransition();
  const [isUploading, setIsUploading] = useState<"ref" | "sheet" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);

  function onSave() {
    setError(null);
    startSaving(async () => {
      const result = await updateBrandCastMember(orgId, brandId, member.id, name, description);
      if (result.ok) setIsEditing(false);
      else setError(result.error);
    });
  }

  function onDeactivate() {
    startDeactivating(async () => {
      await deactivateBrandCastMember(orgId, brandId, member.id);
    });
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>, slot: "ref" | "sheet") {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(slot);
    try {
      const reserved = await reserveBrandCastUploadPath(orgId, brandId, file.name);
      if (!reserved.ok) {
        setError(reserved.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .upload(reserved.path, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const result = await recordBrandCastUpload(orgId, brandId, member.id, reserved.path, slot);
      if (!result.ok) setError(result.error);
    } finally {
      setIsUploading(null);
      if (slot === "ref" && refInputRef.current) refInputRef.current.value = "";
      if (slot === "sheet" && sheetInputRef.current) sheetInputRef.current.value = "";
    }
  }

  const refUrl = member.ref_asset_id ? assetUrls[member.ref_asset_id] : undefined;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      {refUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={refUrl} alt={member.name} className="aspect-square w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-background-raised text-xs text-foreground-muted">
          No reference image
        </div>
      )}

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            className="rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs outline-none disabled:opacity-60"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSaving}
            rows={2}
            className="resize-none rounded-lg border border-border-strong bg-background px-2 py-1.5 text-xs outline-none disabled:opacity-60"
          />
          <div className="flex gap-1.5">
            <AsyncButton
              onClick={onSave}
              isPending={isSaving}
              pendingLabel="Saving..."
              className="rounded-lg bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              Save
            </AsyncButton>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
              className="rounded-lg border border-border-strong px-2 py-1 text-[11px] font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">{member.name}</p>
          {member.description && <p className="text-[11px] text-foreground-muted">{member.description}</p>}
        </div>
      )}

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {!isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-border-strong px-2 py-1 text-[11px] font-medium transition-colors hover:bg-border/40"
          >
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={() => refInputRef.current?.click()}
          disabled={isUploading === "ref"}
          className="rounded-lg border border-border-strong px-2 py-1 text-[11px] font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          {isUploading === "ref" ? "Uploading..." : refUrl ? "Replace image" : "Upload image"}
        </button>
        <button
          type="button"
          onClick={() => sheetInputRef.current?.click()}
          disabled={isUploading === "sheet"}
          className="rounded-lg border border-border-strong px-2 py-1 text-[11px] font-medium transition-colors hover:bg-border/40 disabled:opacity-60"
        >
          {isUploading === "sheet" ? "Uploading..." : member.sheet_asset_id ? "Replace sheet" : "Upload sheet"}
        </button>
        <button
          type="button"
          onClick={onDeactivate}
          disabled={isDeactivating}
          className="rounded-lg border border-border-strong px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
        >
          {isDeactivating ? "Removing..." : "Remove"}
        </button>
        <input
          ref={refInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onUpload(e, "ref")}
        />
        <input
          ref={sheetInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onUpload(e, "sheet")}
        />
      </div>
    </div>
  );
}
