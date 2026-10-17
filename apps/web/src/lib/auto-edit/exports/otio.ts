import { FPS, HEIGHT, WIDTH, type ExportTimeline } from "./timeline";

/**
 * DaVinci Resolve (also): OpenTimelineIO JSON (.otio), which Resolve
 * imports alongside FCPXML. Tracks, trims, gaps, the voiceover and
 * cross dissolves (SMPTE_Dissolve). OTIO has no standard keyframe
 * schema, so Ken Burns moves ride along as clip metadata only; the
 * FCPXML in the same bundle carries the zoom keyframes.
 */

const rt = (frames: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: FPS, value: frames });
const range = (start: number, duration: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start), duration: rt(duration) });

const ref = (file: string, frames: number) => ({
  OTIO_SCHEMA: "ExternalReference.1",
  metadata: {},
  name: "",
  available_range: range(0, frames),
  available_image_bounds: null,
  target_url: file,
});

const clip = (name: string, file: string, frames: number, srcIn: number, dur: number, metadata: Record<string, unknown> = {}) => ({
  OTIO_SCHEMA: "Clip.2",
  metadata,
  name,
  source_range: range(srcIn, dur),
  effects: [],
  markers: [],
  enabled: true,
  media_references: { DEFAULT_MEDIA: ref(file, frames) },
  active_media_reference_key: "DEFAULT_MEDIA",
});

const gap = (frames: number) => ({ OTIO_SCHEMA: "Gap.1", metadata: {}, name: "", source_range: range(0, frames), effects: [], markers: [], enabled: true });

const track = (name: string, kind: "Video" | "Audio", children: unknown[]) => ({
  OTIO_SCHEMA: "Track.1", metadata: {}, name, source_range: null, effects: [], markers: [], enabled: true, children, kind,
});

/** Lays items on one track with gaps between them. */
function laid(items: { start: number; end: number; el: unknown }[]): unknown[] {
  const out: unknown[] = [];
  let t = 0;
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    if (it.start > t) out.push(gap(it.start - t));
    out.push(it.el);
    t = Math.max(t, it.end);
  }
  return out;
}

export function otioJson(t: ExportTimeline): string {
  const v1: unknown[] = [];
  t.video.forEach((c, i) => {
    if (c.transitionIn && i > 0) {
      v1.push({ OTIO_SCHEMA: "Transition.1", metadata: c.transitionType && c.transitionType !== "cross-fade" ? { autocut: { transition: c.transitionType } } : {}, name: "Cross Dissolve", transition_type: "SMPTE_Dissolve", in_offset: rt(c.transitionIn / 2), out_offset: rt(c.transitionIn / 2) });
    }
    v1.push(clip(c.name, c.file, c.mediaFrames, c.in, c.end - c.start, c.motion.length ? { autocut: { kenBurns: c.motion, volume: c.volume } } : { autocut: { volume: c.volume } }));
  });
  const overlays = (layout: "overlay" | "fullFrame") =>
    laid(t.overlays.filter((o) => o.layout === layout).map((o) => ({ start: o.start, end: o.end, el: clip(o.name, o.file, o.mediaFrames, 0, o.end - o.start) })));
  const a1 = laid(t.video.filter((c) => c.hasAudio).map((c) => ({ start: c.start, end: c.end, el: clip(c.name, c.file, c.mediaFrames, c.in, c.end - c.start) })));
  const a2 = laid(t.voiceover.map((v) => ({ start: v.start, end: v.end, el: clip(v.name, v.file, v.mediaFrames, 0, v.end - v.start) })));

  const timeline = {
    OTIO_SCHEMA: "Timeline.1",
    metadata: { autocut: { width: WIDTH, height: HEIGHT, fps: FPS } },
    name: t.name,
    global_start_time: rt(0),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      metadata: {},
      name: "tracks",
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      children: [
        track("V1 Footage", "Video", v1),
        track("V2 Graphics", "Video", overlays("overlay")),
        track("V3 Cards", "Video", overlays("fullFrame")),
        track("A1 Footage", "Audio", a1),
        track("A2 Voiceover", "Audio", a2),
      ],
    },
  };
  return JSON.stringify(timeline, null, 2) + "\n";
}
