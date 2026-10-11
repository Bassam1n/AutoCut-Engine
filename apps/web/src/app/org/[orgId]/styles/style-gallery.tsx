"use client";

import { useMemo, useState, useTransition } from "react";
import type { Style } from "./styles-data";
import { toggleFavouriteStyle } from "./styles-actions";

export function StyleGallery({
  orgId,
  styles,
  favouriteIds,
}: {
  orgId: string;
  styles: Style[];
  favouriteIds: string[];
}) {
  const [favourites, setFavourites] = useState(new Set(favouriteIds));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [selected, setSelected] = useState<Style | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const style of styles) for (const c of style.categories) set.add(c);
    return Array.from(set).sort();
  }, [styles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return styles.filter((style) => {
      if (favouritesOnly && !favourites.has(style.id)) return false;
      if (category && !style.categories.includes(category)) return false;
      if (q && !style.name.toLowerCase().includes(q) && !(style.description ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [styles, search, category, favouritesOnly, favourites]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search styles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-lg border border-border-strong bg-background px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setFavouritesOnly((v) => !v)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            favouritesOnly
              ? "bg-accent-soft text-accent"
              : "border border-border-strong text-foreground hover:bg-border/40"
          }`}
        >
          ★ Favourites
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            category === null ? "bg-accent-soft text-accent" : "border border-border-strong text-foreground-muted hover:bg-border/40"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              category === c ? "bg-accent-soft text-accent" : "border border-border-strong text-foreground-muted hover:bg-border/40"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-foreground-muted">No styles match.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((style) => (
            <StyleCard
              key={style.id}
              orgId={orgId}
              style={style}
              isFavourite={favourites.has(style.id)}
              onToggleFavourite={(next) => {
                setFavourites((prev) => {
                  const copy = new Set(prev);
                  if (next) copy.add(style.id);
                  else copy.delete(style.id);
                  return copy;
                });
              }}
              onOpen={() => setSelected(style)}
            />
          ))}
        </div>
      )}

      {selected && <StyleDetailModal style={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StyleCard({
  orgId,
  style,
  isFavourite,
  onToggleFavourite,
  onOpen,
}: {
  orgId: string;
  style: Style;
  isFavourite: boolean;
  onToggleFavourite: (next: boolean) => void;
  onOpen: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function onFavouriteClick(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !isFavourite;
    onToggleFavourite(next);
    startTransition(async () => {
      const result = await toggleFavouriteStyle(orgId, style.id, next);
      if (!result.ok) onToggleFavourite(!next);
    });
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-background-raised text-left transition-colors hover:border-border-strong"
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
        <button
          type="button"
          onClick={onFavouriteClick}
          disabled={isPending}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-sm transition-colors ${
            isFavourite ? "bg-accent text-accent-ink" : "bg-background/80 text-foreground-muted hover:text-accent"
          }`}
        >
          {isFavourite ? "★" : "☆"}
        </button>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{style.name}</p>
        {style.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-foreground-muted">{style.description}</p>
        )}
      </div>
    </button>
  );
}

function StyleDetailModal({ style, onClose }: { style: Style; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="text-sm font-semibold">{style.name}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {style.description && (
            <p className="mb-3 text-sm text-foreground-muted">{style.description}</p>
          )}
          {style.categories.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {style.categories.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium capitalize text-accent"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Masterprompt
          </p>
          <pre className="whitespace-pre-wrap rounded-lg bg-background p-3 text-xs text-foreground-muted">
            {style.masterprompt ?? "No masterprompt set."}
          </pre>
        </div>
      </div>
    </div>
  );
}
