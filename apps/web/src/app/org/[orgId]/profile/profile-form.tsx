"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/avatar";
import { saveProfile } from "./profile-actions";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function ProfileForm({
  orgId,
  userId,
  email,
  initialName,
  initialPhone,
  initialAvatarPath,
}: {
  orgId: string;
  userId: string;
  email: string;
  initialName: string;
  initialPhone: string;
  initialAvatarPath: string | null;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [avatarPath, setAvatarPath] = useState(initialAvatarPath);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPhotoPicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSaved(false);
    const ext = PHOTO_TYPES[file.type];
    if (!ext) {
      setError("Use a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Photo must be 2 MB or smaller.");
      return;
    }

    setIsUploading(true);
    // A new filename each time so the public URL changes and browsers
    // don't keep showing a cached old photo.
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await createClient()
      .storage.from("avatars")
      .upload(path, file, { contentType: file.type });
    setIsUploading(false);

    if (uploadError) {
      setError(uploadError.message);
      return;
    }
    setAvatarPath(path);
    setAvatarChanged(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveProfile(orgId, {
        fullName,
        phone,
        avatarPath: avatarChanged ? avatarPath : undefined,
      });
      if (result.ok) {
        setSaved(true);
        setAvatarChanged(false);
      } else {
        setError(result.error);
      }
    });
  }

  const busy = isPending || isUploading;

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-5 p-6">
      <div className="flex items-center gap-4">
        <Avatar name={fullName} email={email} avatarPath={avatarPath} size={64} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="btn-secondary btn-sm"
          >
            {isUploading ? "Uploading..." : avatarPath ? "Change photo" : "Upload photo"}
          </button>
          {avatarPath && (
            <button
              type="button"
              onClick={() => {
                setAvatarPath(null);
                setAvatarChanged(true);
                setSaved(false);
              }}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void onPhotoPicked(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Name</span>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={120}
          placeholder="Your full name"
          disabled={busy}
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          placeholder="+1 555 123 4567"
          disabled={busy}
          className="field"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Email</span>
        <input value={email} readOnly disabled className="field" />
        <span className="text-xs text-foreground-muted">
          Your email is managed by your organization. Ask the owner to change it.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary self-start">
          {isPending ? "Saving..." : "Save profile"}
        </button>
        {saved && <span className="text-sm text-accent">Saved.</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </form>
  );
}
