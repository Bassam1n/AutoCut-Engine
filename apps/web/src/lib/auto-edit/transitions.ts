/**
 * Every transition the render engine draws, for the editor's picker, the
 * live preview and the project exports. Each was rendered through the
 * engine's export path and checked frame by frame before being listed
 * here (October 2026); "concat.cube" is left out because it renders as a
 * black frame in a vertical project. The engine takes an id and a length
 * only, so a transition with a direction (slide, linear wipe) plays its
 * default one.
 */

export type TransitionGroup = "Dissolve" | "Dip" | "Slide" | "Wipe" | "Zoom & spin" | "Light & glitch";

/**
 * How the live preview approximates the engine's drawing: CSS on the
 * incoming and outgoing clips, plus an optional colour wash over both.
 * The render is the reference; the preview only has to read the same.
 */
type PreviewLook =
  | "dissolve" | "dip-black" | "dip-white" | "push-left" | "slide-left" | "wipe-right" | "wipe-left" | "wipe-down"
  | "zoom" | "zoom-blur" | "whip" | "blur" | "iris" | "clock" | "spin" | "light" | "flash" | "glitch" | "burn";

export type TransitionInfo = { id: string; label: string; group: TransitionGroup; look: PreviewLook };

export const TRANSITION_CATALOGUE = [
  { id: "cross-fade", label: "Cross dissolve", group: "Dissolve", look: "dissolve" },
  { id: "concat.blur-dissolve", label: "Blur dissolve", group: "Dissolve", look: "blur" },
  { id: "fade-black", label: "Dip to black", group: "Dip", look: "dip-black" },
  { id: "fade-white", label: "Dip to white", group: "Dip", look: "dip-white" },
  { id: "push", label: "Push", group: "Slide", look: "push-left" },
  { id: "concat.slide", label: "Slide", group: "Slide", look: "slide-left" },
  { id: "concat.whip-pan", label: "Whip pan", group: "Slide", look: "whip" },
  { id: "wipe-left", label: "Wipe left", group: "Wipe", look: "wipe-left" },
  { id: "wipe-right", label: "Wipe right", group: "Wipe", look: "wipe-right" },
  { id: "concat.linear-wipe", label: "Soft wipe", group: "Wipe", look: "wipe-right" },
  { id: "concat.rgb-split-wipe", label: "RGB split wipe", group: "Wipe", look: "wipe-down" },
  { id: "concat.iris", label: "Iris", group: "Wipe", look: "iris" },
  { id: "concat.shape-wipe", label: "Circle wipe", group: "Wipe", look: "iris" },
  { id: "concat.clock-wipe", label: "Clock wipe", group: "Wipe", look: "clock" },
  { id: "zoom", label: "Zoom", group: "Zoom & spin", look: "zoom" },
  { id: "concat.zoom-transition", label: "Zoom through", group: "Zoom & spin", look: "zoom" },
  { id: "concat.zoom-blur-transition", label: "Zoom blur", group: "Zoom & spin", look: "zoom-blur" },
  { id: "concat.spin", label: "Spin", group: "Zoom & spin", look: "spin" },
  { id: "concat.swirl", label: "Swirl", group: "Zoom & spin", look: "spin" },
  { id: "concat.light-leak-transition", label: "Light leak", group: "Light & glitch", look: "light" },
  { id: "concat.light-leak-flash", label: "Light flash", group: "Light & glitch", look: "flash" },
  { id: "concat.film-burn", label: "Film burn", group: "Light & glitch", look: "burn" },
  { id: "concat.glitch-transition", label: "Glitch", group: "Light & glitch", look: "glitch" },
  { id: "concat.glitch-warp", label: "Glitch warp", group: "Light & glitch", look: "glitch" },
] as const satisfies readonly TransitionInfo[];

export type TransitionId = (typeof TRANSITION_CATALOGUE)[number]["id"];

export const TRANSITION_GROUPS: TransitionGroup[] = ["Dissolve", "Dip", "Slide", "Wipe", "Zoom & spin", "Light & glitch"];

const BY_ID = new Map<string, TransitionInfo>(TRANSITION_CATALOGUE.map((t) => [t.id, t]));

export function transitionInfo(id: string): TransitionInfo {
  return BY_ID.get(id) ?? TRANSITION_CATALOGUE[0];
}

export function transitionLabel(id: string | null | undefined): string {
  return !id || id === "cut" ? "Cut" : transitionInfo(id).label;
}

/** CSS for one side of a transition at progress p (0..1). */
export type TransitionStyle = {
  opacity?: number;
  /** Extra transform, applied after the clip's own Ken Burns move. */
  transform?: string;
  clipPath?: string;
  filter?: string;
};

/** What the preview draws for a transition at progress p: styles for both clips and an optional wash over them. */
export function transitionLook(id: string, p: number): { incoming: TransitionStyle; outgoing: TransitionStyle; wash?: { color: string; opacity: number } } {
  const x = Math.min(1, Math.max(0, p));
  const ease = x * x * (3 - 2 * x);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const bell = 1 - Math.abs(2 * x - 1); // 0 at the edges, 1 mid-way
  switch (transitionInfo(id).look) {
    case "dip-black":
    case "dip-white":
      // Out to the colour over the first half, in from it over the second.
      return { incoming: { opacity: x < 0.5 ? 0 : 1 }, outgoing: {}, wash: { color: transitionInfo(id).look === "dip-black" ? "#000" : "#fff", opacity: bell } };
    case "push-left":
      return { incoming: { transform: `translateX(${pct(1 - ease)})` }, outgoing: { transform: `translateX(${pct(-ease)})` } };
    case "slide-left":
      return { incoming: { transform: `translateX(${pct(1 - ease)})` }, outgoing: {} };
    case "whip":
      return { incoming: { transform: `translateX(${pct(1 - ease)})`, filter: `blur(${(bell * 14).toFixed(1)}px)` }, outgoing: { transform: `translateX(${pct(-ease)})`, filter: `blur(${(bell * 14).toFixed(1)}px)` } };
    case "wipe-right":
      return { incoming: { clipPath: `inset(0 ${pct(1 - ease)} 0 0)` }, outgoing: {} };
    case "wipe-left":
      return { incoming: { clipPath: `inset(0 0 0 ${pct(1 - ease)})` }, outgoing: {} };
    case "wipe-down":
      return { incoming: { clipPath: `inset(0 0 ${pct(1 - ease)} 0)` }, outgoing: { filter: `hue-rotate(${Math.round(bell * 90)}deg)` } };
    case "iris":
      return { incoming: { clipPath: `circle(${(ease * 75).toFixed(2)}% at 50% 50%)` }, outgoing: {} };
    case "clock": {
      // A sweep from 12 o'clock, as a polygon fan.
      const pts = ["50% 50%", "50% 0%"];
      const steps = Math.max(1, Math.ceil(ease * 24));
      for (let k = 1; k <= steps; k++) {
        const a = (Math.min(k / 24, ease) * 2 * Math.PI) - Math.PI / 2;
        pts.push(`${(50 + 100 * Math.cos(a)).toFixed(1)}% ${(50 + 100 * Math.sin(a)).toFixed(1)}%`);
      }
      return { incoming: { clipPath: ease >= 0.999 ? "none" : `polygon(${pts.join(",")})` }, outgoing: {} };
    }
    case "zoom":
      return { incoming: { opacity: ease, transform: `scale(${(0.8 + 0.2 * ease).toFixed(3)})` }, outgoing: { transform: `scale(${(1 + 0.25 * ease).toFixed(3)})` } };
    case "zoom-blur":
      return { incoming: { opacity: ease, transform: `scale(${(1.25 - 0.25 * ease).toFixed(3)})`, filter: `blur(${(bell * 10).toFixed(1)}px)` }, outgoing: { transform: `scale(${(1 + 0.25 * ease).toFixed(3)})`, filter: `blur(${(bell * 10).toFixed(1)}px)` } };
    case "spin":
      return { incoming: { opacity: ease, transform: `rotate(${((1 - ease) * -90).toFixed(1)}deg) scale(${(0.6 + 0.4 * ease).toFixed(3)})` }, outgoing: { transform: `rotate(${(ease * 90).toFixed(1)}deg) scale(${(1 - 0.4 * ease).toFixed(3)})` } };
    case "blur":
      return { incoming: { opacity: ease, filter: `blur(${(bell * 12).toFixed(1)}px)` }, outgoing: { filter: `blur(${(bell * 12).toFixed(1)}px)` } };
    case "light":
      return { incoming: { opacity: ease }, outgoing: {}, wash: { color: "#ffd9a8", opacity: bell * 0.85 } };
    case "flash":
    case "burn":
      return { incoming: { opacity: x < 0.5 ? 0 : 1 }, outgoing: {}, wash: { color: transitionInfo(id).look === "burn" ? "#fff4e0" : "#fff", opacity: bell } };
    case "glitch":
      return { incoming: { opacity: x < 0.5 ? 0 : 1, filter: `hue-rotate(${Math.round(bell * 180)}deg) saturate(${(1 + bell * 2).toFixed(2)})`, transform: `translateX(${pct(Math.sin(x * 40) * 0.03 * bell)})` }, outgoing: { filter: `hue-rotate(${Math.round(bell * 180)}deg)` } };
    case "dissolve":
    default:
      return { incoming: { opacity: x }, outgoing: {} };
  }
}
