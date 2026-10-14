"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSceneStyle } from "../scene-style-actions";

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

/**
 * Per-scene style: "Ad style" inherits the ad's look; picking another
 * style makes just this scene render in it (mixed-style ads).
 */
export function SceneStylePicker({ sceneId, styleId }: { sceneId: string; styleId: string | null }) {
  const ctx = useContext(SceneStyleContext);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(styleId ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!ctx) return null;

  const adStyleName = ctx.styles.find((s) => s.id === ctx.adStyleId)?.name ?? "none";
  const custom = value !== "" && value !== ctx.adStyleId;

  function change(next: string) {
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
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label="Scene style"
        value={value}
        disabled={isPending}
        onChange={(e) => change(e.target.value)}
        title="Style for this scene. Mix styles across scenes, e.g. a UGC talking head then a 3D anatomy cutaway."
        className={`field field-sm max-w-44 py-1 text-xs ${custom ? "border-accent text-accent" : ""}`}
      >
        <option value="">Ad style ({adStyleName})</option>
        {ctx.styles
          .filter((s) => s.id !== ctx.adStyleId)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
