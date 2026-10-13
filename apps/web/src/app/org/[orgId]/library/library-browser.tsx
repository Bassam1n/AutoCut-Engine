"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncButton } from "@/components/async-button";
import { Modal, PromptModal } from "@/components/modal";
import { MediaLightbox } from "@/components/media-lightbox";
import {
  renameLibraryItem,
  setLibraryItemFavorite,
  assignLibraryItemBrand,
  deleteLibraryItem,
  setCharacterReference,
  setStyleReference,
  listOrgEditableStyles,
} from "./library-actions";
import type { LibraryItem, LibraryCastMemberOption } from "./library-data";
import type { Brand } from "../brands/brands-data";

type TypeFilter = "all" | "image" | "video";
type TimeFilter = "all" | "7d" | "30d";

export function LibraryBrowser({
  orgId,
  items,
  brands,
  castMembers,
  urls,
}: {
  orgId: string;
  items: LibraryItem[];
  brands: Brand[];
  castMembers: LibraryCastMemberOption[];
  urls: Record<string, string>;
}) {
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<LibraryItem | null>(null);
  // Date.now() is an impure call the React Compiler forbids inside a
  // render-phase computation (useMemo's body included) — captured
  // once via a lazy useState initializer (runs only at mount, not on
  // every render) rather than called directly inside the filter memo
  // below. "Last 7/30 days" only needs to be approximately now, not
  // re-evaluated on every keystroke.
  const [now] = useState(() => Date.now());

  const brandNameById = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== "all" && item.asset_kind !== typeFilter) return false;
      if (brandFilter !== "all" && item.brand_id !== brandFilter) return false;
      if (favoritesOnly && !item.favorite) return false;
      if (timeFilter !== "all") {
        const ageMs = now - new Date(item.created_at).getTime();
        const cutoffMs = (timeFilter === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
        if (ageMs > cutoffMs) return false;
      }
      if (q) {
        const haystack = `${item.name ?? ""} ${item.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, brandFilter, typeFilter, timeFilter, favoritesOnly, now]);

  return (
    <div className="flex flex-col gap-5">
      <div className="card-inset flex flex-wrap items-center gap-3 p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or tag..."
          className="field min-w-[200px] flex-1"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="field field-sm"
        >
          <option value="all">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="field field-sm"
        >
          <option value="all">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
          className="field field-sm"
        >
          <option value="all">Any time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border-strong"
          />
          Favourites only
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {items.length === 0
            ? "Nothing saved yet — save an image or video from Scene images or Scene videos."
            : "No items match these filters."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((item) => (
            <LibraryCard
              key={item.id}
              orgId={orgId}
              item={item}
              url={urls[item.asset_storage_path]}
              brandName={item.brand_id ? brandNameById.get(item.brand_id) ?? null : null}
              brands={brands}
              castMembers={castMembers}
              onExpand={() => setLightboxItem(item)}
            />
          ))}
        </div>
      )}

      {lightboxItem && (
        <MediaLightbox
          kind={lightboxItem.asset_kind === "video" ? "video" : "image"}
          url={urls[lightboxItem.asset_storage_path]}
          alt={lightboxItem.name ?? "Library item"}
          onClose={() => setLightboxItem(null)}
        />
      )}
    </div>
  );
}

function LibraryCard({
  orgId,
  item,
  url,
  brandName,
  brands,
  castMembers,
  onExpand,
}: {
  orgId: string;
  item: LibraryItem;
  url: string | undefined;
  brandName: string | null;
  brands: Brand[];
  castMembers: LibraryCastMemberOption[];
  onExpand: () => void;
}) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [isAssigningBrand, setIsAssigningBrand] = useState(false);
  const [isSettingCast, setIsSettingCast] = useState(false);
  const [isSettingStyle, setIsSettingStyle] = useState(false);
  const [isFavoritePending, setIsFavoritePending] = useState(false);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggleFavorite() {
    setIsFavoritePending(true);
    setError(null);
    try {
      const result = await setLibraryItemFavorite(orgId, item.id, !item.favorite);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsFavoritePending(false);
    }
  }

  async function onRename(value: string) {
    setIsRenaming(false);
    const result = await renameLibraryItem(orgId, item.id, value);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function onAssignBrand(brandId: string) {
    setIsAssigningBrand(false);
    const result = await assignLibraryItemBrand(orgId, item.id, brandId || null);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function onDelete() {
    setIsDeletePending(true);
    setError(null);
    try {
      const result = await deleteLibraryItem(orgId, item.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsDeletePending(false);
    }
  }

  // Native HTML5 drag-and-drop (spec §5.9: "Drag a library item into
  // a scene") — no npm dependency, consumed by SceneDropTarget in
  // Scene images' mini-library panel. The asset id is all a drop
  // target needs (addLibraryItemToScene() looks the rest up itself).
  function onDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("application/x-library-asset-id", item.asset_id);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div
      draggable={item.asset_kind === "image"}
      onDragStart={onDragStart}
      className="card-inset flex flex-col gap-2 p-3"
    >
      <div className="relative">
        <button
          type="button"
          onClick={onExpand}
          className="block w-full overflow-hidden rounded-lg transition-opacity hover:opacity-90"
        >
          {url ? (
            item.asset_kind === "video" ? (
              <video src={url} className="aspect-square w-full bg-black object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={item.name ?? "Library item"} className="aspect-square w-full object-cover" />
            )
          ) : (
            <div className="flex aspect-square w-full items-center justify-center bg-border text-xs text-foreground-muted">
              Unavailable
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          disabled={isFavoritePending}
          title={item.favorite ? "Unfavourite" : "Favourite"}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-60"
        >
          {item.favorite ? "★" : "☆"}
        </button>
        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
          {item.asset_kind}
        </span>
      </div>

      <p className="truncate text-xs font-medium" title={item.name ?? "Untitled"}>
        {item.name ?? "Untitled"}
      </p>
      {item.tags.length > 0 && (
        <p className="truncate text-[11px] text-foreground-muted" title={item.tags.join(", ")}>
          {item.tags.join(", ")}
        </p>
      )}
      <p className="text-[11px] text-foreground-muted">{brandName ?? "No brand"}</p>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setIsRenaming(true)}
          className="btn-secondary btn-xs"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setIsAssigningBrand(true)}
          className="btn-secondary btn-xs"
        >
          Brand
        </button>
        <button
          type="button"
          onClick={() => setIsSettingCast(true)}
          className="btn-secondary btn-xs"
        >
          Character ref
        </button>
        <button
          type="button"
          onClick={() => setIsSettingStyle(true)}
          className="btn-secondary btn-xs"
        >
          Style ref
        </button>
        <AsyncButton
          onClick={onDelete}
          isPending={isDeletePending}
          pendingLabel="..."
          className="rounded-lg border border-danger/40 px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/10"
        >
          Remove
        </AsyncButton>
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      {isRenaming && (
        <PromptModal
          title="Rename"
          label="Name"
          placeholder={item.name ?? ""}
          onSubmit={onRename}
          onClose={() => setIsRenaming(false)}
        />
      )}

      {isAssigningBrand && (
        <Modal title="Assign brand" onClose={() => setIsAssigningBrand(false)}>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => onAssignBrand("")}
              className="rounded-lg px-3 py-2 text-left text-sm hover:bg-border/40"
            >
              No brand
            </button>
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onAssignBrand(b.id)}
                className="rounded-lg px-3 py-2 text-left text-sm hover:bg-border/40"
              >
                {b.name}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {isSettingCast && (
        <CharacterReferenceModal
          orgId={orgId}
          assetId={item.asset_id}
          castMembers={castMembers}
          onClose={() => setIsSettingCast(false)}
          onDone={() => {
            setIsSettingCast(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {isSettingStyle && (
        <StyleReferenceModal
          orgId={orgId}
          assetId={item.asset_id}
          onClose={() => setIsSettingStyle(false)}
          onDone={() => {
            setIsSettingStyle(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function CharacterReferenceModal({
  orgId,
  assetId,
  castMembers,
  onClose,
  onDone,
  onError,
}: {
  orgId: string;
  assetId: string;
  castMembers: LibraryCastMemberOption[];
  onClose: () => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  const [field, setField] = useState<"ref_asset_id" | "sheet_asset_id">("ref_asset_id");
  const [isSaving, setIsSaving] = useState(false);

  async function onPick(castMemberId: string) {
    setIsSaving(true);
    try {
      const result = await setCharacterReference(orgId, castMemberId, field, assetId);
      if (!result.ok) {
        onError(result.error);
        onClose();
      } else {
        onDone();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Set as character reference" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setField("ref_asset_id")}
            className={`rounded-lg border px-2.5 py-1 font-medium ${
              field === "ref_asset_id" ? "border-accent text-accent" : "border-border-strong"
            }`}
          >
            Reference image
          </button>
          <button
            type="button"
            onClick={() => setField("sheet_asset_id")}
            className={`rounded-lg border px-2.5 py-1 font-medium ${
              field === "sheet_asset_id" ? "border-accent text-accent" : "border-border-strong"
            }`}
          >
            Reference sheet
          </button>
        </div>
        {castMembers.length === 0 ? (
          <p className="text-sm text-foreground-muted">No cast members exist yet in this org.</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {castMembers.map((c) => (
              <button
                key={c.cast_member_id}
                type="button"
                disabled={isSaving}
                onClick={() => onPick(c.cast_member_id)}
                className="rounded-lg px-3 py-2 text-left text-sm hover:bg-border/40 disabled:opacity-60"
              >
                <span className="font-medium">{c.cast_member_name}</span>
                <span className="ml-1.5 text-xs text-foreground-muted">— {c.ad_name ?? "untitled ad"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function StyleReferenceModal({
  orgId,
  assetId,
  onClose,
  onDone,
  onError,
}: {
  orgId: string;
  assetId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  const [styles, setStyles] = useState<{ id: string; name: string }[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOrgEditableStyles(orgId).then((result) => {
      if (!cancelled) setStyles(result);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function onPick(styleId: string) {
    setIsSaving(true);
    try {
      const result = await setStyleReference(orgId, styleId, assetId);
      if (!result.ok) {
        onError(result.error);
        onClose();
      } else {
        onDone();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Set as style reference" onClose={onClose}>
      <div className="flex flex-col gap-1">
        <p className="mb-1 text-xs text-foreground-muted">
          Only your org&apos;s own styles can be edited — shared platform styles aren&apos;t listed.
        </p>
        {styles === null ? (
          <p className="text-sm text-foreground-muted">Loading styles...</p>
        ) : styles.length === 0 ? (
          <p className="text-sm text-foreground-muted">No org-owned styles yet.</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {styles.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={isSaving}
                onClick={() => onPick(s.id)}
                className="rounded-lg px-3 py-2 text-left text-sm hover:bg-border/40 disabled:opacity-60"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
