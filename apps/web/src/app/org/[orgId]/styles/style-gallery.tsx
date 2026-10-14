"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Style } from "./styles-data";
import { generateStylePreview, toggleFavouriteStyle } from "./styles-actions";
import type { ModelOption } from "@/lib/providers/models-data";
import { defaultPreviewSubject } from "@/lib/style-previews";

/** Present only for people who can set at least one style's preview. */
export type PreviewAccess = {
  platformAdmin: boolean;
  orgAdmin: boolean;
  modelOptions: ModelOption[];
  providersWithKeys: string[];
};

type Model = { provider: "fal" | "kie"; endpoint: string };

export function StyleGallery({
  orgId,
  styles: initialStyles,
  favouriteIds,
  preview,
}: {
  orgId: string;
  styles: Style[];
  favouriteIds: string[];
  preview: PreviewAccess | null;
}) {
  // Previews update in place as they're generated, without a reload.
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const styles = useMemo(
    () => initialStyles.map((s) => (previewUrls[s.id] ? { ...s, preview_image_url: previewUrls[s.id] } : s)),
    [initialStyles, previewUrls]
  );
  const canEdit = (style: Style) =>
    preview !== null && (style.org_id === null ? preview.platformAdmin : preview.orgAdmin);
  const [model, setModel] = useState<Model | null>(() => {
    const first = preview?.modelOptions.find((o) => preview.providersWithKeys.includes(o.provider)) ?? preview?.modelOptions[0];
    return first ? { provider: first.provider as Model["provider"], endpoint: first.endpoint } : null;
  });
  const onPreview = (id: string, url: string) => setPreviewUrls((prev) => ({ ...prev, [id]: url }));
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
          className="field w-56"
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

      {preview && (
        <BulkPreviewBar
          orgId={orgId}
          missing={styles.filter((s) => canEdit(s) && !s.preview_image_url)}
          preview={preview}
          model={model}
          onModel={setModel}
          onPreview={onPreview}
        />
      )}

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

      {selected && (
        <StyleDetailModal
          orgId={orgId}
          style={styles.find((s) => s.id === selected.id) ?? selected}
          editable={canEdit(selected)}
          preview={preview}
          model={model}
          onModel={setModel}
          onPreview={onPreview}
          onClose={() => setSelected(null)}
        />
      )}
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
      className="card card-interactive group relative flex flex-col overflow-hidden text-left"
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

function ModelSelect({
  preview,
  model,
  onModel,
}: {
  preview: PreviewAccess;
  model: Model | null;
  onModel: (m: Model) => void;
}) {
  const hasKey = model ? preview.providersWithKeys.includes(model.provider) : false;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">Image model</span>
      <select
        value={model ? `${model.provider}::${model.endpoint}` : ""}
        onChange={(e) => {
          const [provider, endpoint] = e.target.value.split("::");
          onModel({ provider: provider as Model["provider"], endpoint });
        }}
        className="field field-sm"
      >
        {preview.modelOptions.map((o) => (
          <option key={`${o.provider}::${o.endpoint}`} value={`${o.provider}::${o.endpoint}`}>
            {o.name} ({o.provider}){preview.providersWithKeys.includes(o.provider) ? "" : " — no key saved"}
          </option>
        ))}
      </select>
      {model && !hasKey && (
        <span className="text-xs text-danger">No {model.provider} key saved for this agency. Add one in Org-wide keys.</span>
      )}
    </label>
  );
}

/** Seconds counter for long inline generations. */
function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setS(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(t);
      setS(0);
    };
  }, [running]);
  return s;
}

function BulkPreviewBar({
  orgId,
  missing,
  preview,
  model,
  onModel,
  onPreview,
}: {
  orgId: string;
  missing: Style[];
  preview: PreviewAccess;
  model: Model | null;
  onModel: (m: Model) => void;
  onPreview: (id: string, url: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const elapsed = useElapsed(running);

  async function runAll() {
    if (!model) return;
    const queue = [...missing];
    setRunning(true);
    setDone(0);
    setTotal(queue.length);
    setFailures([]);
    // One at a time: each call polls the provider inline for up to ~3 min.
    for (const style of queue) {
      const result = await generateStylePreview(orgId, style.id, defaultPreviewSubject(style.name), model);
      if (result.ok) onPreview(style.id, result.url);
      else setFailures((f) => [...f, `${style.name}: ${result.error}`]);
      setDone((d) => d + 1);
    }
    setRunning(false);
  }

  if (missing.length === 0 && !running && failures.length === 0) return null;

  return (
    <div className="card-inset flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {running
              ? `Generating previews… ${done} of ${total} (${elapsed}s)`
              : `${missing.length} style${missing.length === 1 ? " has" : "s have"} no preview image`}
          </p>
          <p className="text-xs text-foreground-muted">
            Uses this agency&apos;s provider keys. Each preview is one image generation.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <ModelSelect preview={preview} model={model} onModel={onModel} />
          <button
            type="button"
            onClick={runAll}
            disabled={running || !model || missing.length === 0}
            className="btn-primary btn-sm"
          >
            {running ? "Generating..." : "Generate missing previews"}
          </button>
        </div>
      </div>
      {failures.length > 0 && (
        <ul className="list-inside list-disc text-xs text-danger">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreviewPanel({
  orgId,
  style,
  preview,
  model,
  onModel,
  onPreview,
}: {
  orgId: string;
  style: Style;
  preview: PreviewAccess;
  model: Model | null;
  onModel: (m: Model) => void;
  onPreview: (id: string, url: string) => void;
}) {
  const [subject, setSubject] = useState(defaultPreviewSubject(style.name));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(isPending);

  function generate() {
    if (!model) return;
    setError(null);
    startTransition(async () => {
      const result = await generateStylePreview(orgId, style.id, subject, model);
      if (result.ok) onPreview(style.id, result.url);
      else setError(result.error);
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Preview image</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">What the preview shows</span>
        <textarea rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} className="field resize-y text-xs" />
      </label>
      <ModelSelect preview={preview} model={model} onModel={onModel} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={generate} disabled={isPending || !model} className="btn-primary btn-sm">
          {isPending ? `Generating... (${elapsed}s)` : style.preview_image_url ? "Regenerate preview" : "Generate preview"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}

function StyleDetailModal({
  orgId,
  style,
  editable,
  preview,
  model,
  onModel,
  onPreview,
  onClose,
}: {
  orgId: string;
  style: Style;
  editable: boolean;
  preview: PreviewAccess | null;
  model: Model | null;
  onModel: (m: Model) => void;
  onPreview: (id: string, url: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden"
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
          {style.preview_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={style.preview_image_url}
              alt={`${style.name} preview`}
              className="mb-4 aspect-[4/5] w-full rounded-xl border border-border object-cover"
            />
          )}
          {editable && preview && (
            <PreviewPanel
              key={style.id}
              orgId={orgId}
              style={style}
              preview={preview}
              model={model}
              onModel={onModel}
              onPreview={onPreview}
            />
          )}
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
