"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySceneStyles, setSceneStyle, suggestSceneStyles, type StyleSuggestion } from "../scene-style-actions";

export type StyleChoice = { id: string; name: string; preview_image_url: string | null };

type Ctx = {
  orgId: string;
  brandId: string;
  productId: string;
  adId: string;
  adStyleId: string | null;
  styles: StyleChoice[];
};

const SceneStyleContext = createContext<Ctx | null>(null);

/** Set once in StudioCanvas so any step can render a per-scene style picker. */
export function SceneStyleProvider({ value, children }: { value: Ctx; children: React.ReactNode }) {
  return <SceneStyleContext.Provider value={value}>{children}</SceneStyleContext.Provider>;
}

/** Small style thumbnail, or a lettered tile when no preview exists yet. */
function StyleThumb({ style, size }: { style: StyleChoice | undefined; size: "sm" | "lg" }) {
  const dims = size === "sm" ? "h-5 w-4 rounded" : "h-20 w-16 rounded-lg";
  if (style?.preview_image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={style.preview_image_url} alt="" className={`${dims} shrink-0 object-cover`} loading="lazy" />;
  }
  return (
    <span className={`${dims} flex shrink-0 items-center justify-center bg-accent-soft text-[10px] font-semibold text-accent`}>
      {style?.name.slice(0, 1) ?? "?"}
    </span>
  );
}

/**
 * Per-scene style: "Ad style" inherits the ad's look; picking another
 * style makes just this scene render in it (mixed-style ads). A custom
 * popover instead of a native <select> so every option shows its
 * preview image — editors pick a look by seeing it, not by name.
 */
export function SceneStylePicker({ sceneId, styleId }: { sceneId: string; styleId: string | null }) {
  const ctx = useContext(SceneStyleContext);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(styleId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ctx) return null;

  const adStyle = ctx.styles.find((s) => s.id === ctx.adStyleId);
  const custom = value !== "" && value !== ctx.adStyleId;
  const current = custom ? ctx.styles.find((s) => s.id === value) : adStyle;
  const options: { id: string; label: string; style: StyleChoice | undefined; note?: string }[] = [
    { id: "", label: adStyle?.name ?? "No style", style: adStyle, note: "Ad style" },
    ...ctx.styles.filter((s) => s.id !== ctx.adStyleId).map((s) => ({ id: s.id, label: s.name, style: s })),
  ];

  function change(next: string) {
    setOpen(false);
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await setSceneStyle(ctx!.orgId, ctx!.brandId, ctx!.productId, ctx!.adId, sceneId, next || null);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span ref={rootRef} className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Scene style: ${current?.name ?? "none"}${custom ? "" : " (ad style)"}`}
        disabled={isPending}
        onClick={() => setOpen((o) => !o)}
        title="Style for this scene. Mix styles across scenes, e.g. a UGC talking head then a 3D anatomy cutaway."
        className={`inline-flex max-w-52 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-xs transition-colors disabled:opacity-60 ${
          custom ? "border-accent text-accent" : "border-border-strong text-foreground hover:bg-border/40"
        }`}
      >
        <StyleThumb style={current} size="sm" />
        <span className="truncate">{custom ? current?.name : `Ad style (${adStyle?.name ?? "none"})`}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Scene style"
          className="card absolute left-0 top-full z-40 mt-1.5 max-h-[70vh] w-[min(460px,85vw)] overflow-y-auto p-2"
        >
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {options.map((o) => {
              const selected = o.id === value || (o.id === "" && !custom);
              return (
                <button
                  key={o.id || "ad"}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => change(o.id)}
                  className={`flex items-center gap-2 rounded-xl border p-1.5 text-left transition-colors ${
                    selected ? "border-accent bg-accent-soft" : "border-transparent hover:bg-border/40"
                  }`}
                >
                  <StyleThumb style={o.style} size="lg" />
                  <span className="min-w-0">
                    {o.note && <span className="block text-[10px] font-medium uppercase tracking-wide text-accent">{o.note}</span>}
                    <span className="block text-xs font-medium leading-snug">{o.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/**
 * "Suggest styles": Claude proposes a style per scene (or keeping the
 * ad's default) with a reason. Nothing changes until the editor applies
 * one suggestion or all of them.
 */
export function SuggestStylesPanel({ currentStyles }: { currentStyles: Record<string, string | null> }) {
  const ctx = useContext(SceneStyleContext);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<StyleSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ctx) return null;

  const styleById = new Map(ctx.styles.map((s) => [s.id, s]));
  const adStyle = ctx.adStyleId ? styleById.get(ctx.adStyleId) : undefined;
  const pending = (suggestions ?? []).filter((s) => (currentStyles[s.sceneId] ?? null) !== s.styleId);

  function suggest() {
    setError(null);
    startTransition(async () => {
      const result = await suggestSceneStyles(ctx!.orgId, ctx!.brandId, ctx!.productId, ctx!.adId);
      if (result.ok) setSuggestions(result.suggestions);
      else setError(result.error);
    });
  }

  function apply(changes: StyleSuggestion[]) {
    setError(null);
    startTransition(async () => {
      const result = await applySceneStyles(
        ctx!.orgId,
        ctx!.brandId,
        ctx!.productId,
        ctx!.adId,
        changes.map((c) => ({ sceneId: c.sceneId, styleId: c.styleId }))
      );
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="card-inset flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">Scene styles</p>
          <p className="text-xs text-foreground-muted">
            Mix looks within one ad, like a UGC hook, an anatomy cutaway and a clean packshot.
          </p>
        </div>
        <button type="button" onClick={suggest} disabled={isPending} className="btn-secondary btn-sm">
          {isPending && !suggestions ? "Thinking..." : suggestions ? "Suggest again" : "✨ Suggest styles"}
        </button>
      </div>

      {suggestions && (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {suggestions.map((s) => {
              const style = s.styleId ? styleById.get(s.styleId) : adStyle;
              const applied = (currentStyles[s.sceneId] ?? null) === s.styleId;
              return (
                <li key={s.sceneId} className="flex items-center gap-3 py-2">
                  <StyleThumb style={style} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-medium">Scene {s.sceneNumber}:</span>{" "}
                      {s.styleId ? style?.name : `keep ad style (${adStyle?.name ?? "none"})`}
                    </p>
                    <p className="text-xs text-foreground-muted">{s.reason}</p>
                  </div>
                  {applied ? (
                    <span className="text-xs text-foreground-muted">Applied</span>
                  ) : (
                    <button type="button" onClick={() => apply([s])} disabled={isPending} className="btn-ghost btn-xs">
                      Apply
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {pending.length > 0 && (
            <button type="button" onClick={() => apply(pending)} disabled={isPending} className="btn-primary btn-sm self-start">
              {isPending ? "Applying..." : `Apply all (${pending.length})`}
            </button>
          )}
          <p className="text-xs text-foreground-muted">Already-generated images keep their look until you regenerate that scene.</p>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
