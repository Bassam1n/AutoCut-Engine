import { clipStarts, planLength, voiceoverStarts, type EditPlan } from "../plan-schema";

/**
 * The plan as an editing timeline in whole frames at 30 fps, the common
 * ground every "Export project for..." writer works from. Times are
 * rounded to the nearest frame once, here, so all formats agree.
 *
 * Track layout, same as the render engine's: V1 footage, V2 overlay
 * graphics, V3 full-frame cards; A1 the footage's own sound, A2 the
 * separate voiceover. Captions go out as an SRT next to the project.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const f = (seconds: number) => Math.round(seconds * FPS);

/** Bundled media as the export sees it: paths relative to the bundle root. */
export type ExportMedia = {
  scenes: Record<number, { file: string; duration: number; width: number; height: number; hasAudio: boolean }>;
  voiceovers: Record<number, { file: string; duration: number }>;
  graphics: Record<string, { file: string; duration: number; alpha: boolean }>;
};

export type MotionKey = { frame: number; scale: number; offsetX: number; offsetY: number };

export type VideoItem = {
  index: number;
  name: string;
  file: string;
  scene: number;
  /** Timeline frames [start, end). */
  start: number;
  end: number;
  /** Source frames [in, out). */
  in: number;
  out: number;
  mediaFrames: number;
  /** The scene clip's own frame size. */
  width: number;
  height: number;
  hasAudio: boolean;
  volume: number;
  /** Cross-dissolve centred on this clip's head, total frames (0 = cut). */
  transitionIn: number;
  /** Ken Burns keys at timeline-relative frames within the clip (0..end-start). */
  motion: MotionKey[];
};

export type OverlayItem = { id: string; name: string; file: string; start: number; end: number; mediaFrames: number; layout: "overlay" | "fullFrame"; alpha: boolean };
export type AudioItem = { scene: number; name: string; file: string; start: number; end: number; mediaFrames: number };
export type CaptionItem = { start: number; end: number; text: string };

export type ExportTimeline = {
  name: string;
  duration: number;
  video: VideoItem[];
  overlays: OverlayItem[];
  voiceover: AudioItem[];
  captions: CaptionItem[];
};

export function buildExportTimeline(plan: EditPlan, media: ExportMedia, name: string): ExportTimeline {
  const starts = clipStarts(plan);
  const duration = f(planLength(plan));

  // Clip boundaries are rounded through cumulative times, so clips stay abutted.
  const video: VideoItem[] = plan.clips.map((c, i) => {
    const m = media.scenes[c.scene];
    if (!m) throw new Error(`no media for scene ${c.scene}`);
    const start = f(starts[i]);
    const end = f(starts[i] + (c.sourceOut - c.sourceIn));
    const inF = f(c.sourceIn);
    const len = end - start;
    const motion = (c.motion?.keys ?? []).map((k) => ({ frame: Math.round(k.at * len), scale: k.scale, offsetX: k.offsetX, offsetY: k.offsetY }));
    const t = c.transitionIn && c.transitionIn.type !== "cut" && i > 0 ? Math.max(2, 2 * Math.round(f(c.transitionIn.duration) / 2)) : 0;
    return {
      index: i, name: `Scene ${c.scene + 1}`, file: m.file, scene: c.scene, start, end, in: inF, out: inF + len,
      mediaFrames: f(m.duration), width: m.width, height: m.height, hasAudio: m.hasAudio, volume: c.volume, transitionIn: t, motion,
    };
  });

  const overlays: OverlayItem[] = plan.graphics.map((g) => {
    const m = media.graphics[g.id];
    if (!m) throw new Error(`no media for graphic ${g.id}`);
    const start = f(g.start);
    return { id: g.id, name: g.id, file: m.file, start, end: start + f(g.duration), mediaFrames: Math.max(f(m.duration), f(g.duration)), layout: g.layout, alpha: m.alpha };
  });

  const voStarts = voiceoverStarts(plan);
  const voiceover: AudioItem[] = Object.entries(media.voiceovers)
    .map(([scene, m]) => ({ scene: Number(scene), m }))
    .filter(({ scene }) => voStarts[scene] !== undefined)
    .map(({ scene, m }) => {
      const start = f(voStarts[scene]);
      const end = Math.min(duration, start + f(m.duration));
      return { scene, name: `Voiceover scene ${scene + 1}`, file: m.file, start, end, mediaFrames: f(m.duration) };
    })
    .filter((a) => a.end > a.start)
    .sort((a, b) => a.start - b.start);

  const captions = plan.captions.map((c) => ({ start: f(c.start), end: f(c.end), text: c.text }));
  return { name, duration, video, overlays, voiceover, captions };
}

/** "N/30s" style rational seconds for FCPXML, reduced. */
export function rational(frames: number): string {
  if (frames === 0) return "0s";
  const g = gcd(Math.abs(frames), FPS);
  const n = frames / g;
  const d = FPS / g;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** SMPTE timecode at 30 fps, non-drop. */
export function timecode(frames: number): string {
  const ff = frames % FPS;
  const s = Math.floor(frames / FPS);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function xml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
