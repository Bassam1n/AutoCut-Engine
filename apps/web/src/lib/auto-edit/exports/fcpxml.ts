import { HEIGHT, WIDTH, rational, xml, type ExportTimeline, type VideoItem } from "./timeline";

/**
 * DaVinci Resolve and Final Cut Pro: FCPXML 1.8, the newest version whose
 * assets name their file in a src attribute; Final Cut Pro 10.4 and later
 * and Resolve 17 and later import it, and so does OpenTimelineIO, which
 * the tests use to re-import every export. The footage is the
 * primary storyline (trims, cross dissolves, zoom keyframes, clip
 * volume); graphics are connected clips above it (lane 1 overlays,
 * lane 2 full-frame cards) and the voiceover is connected below
 * (lane -1). An end card that runs past the footage sits on a gap.
 * Captions travel separately as SRT.
 *
 * Element order follows the FCPXML 1.8 DTD. Media are referenced by
 * paths relative to the .fcpxml file.
 */

const DISSOLVE_UID = "FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265";

type SpineItem = { kind: "clip"; item: VideoItem; offset: number; end: number } | { kind: "gap"; offset: number; end: number };

export function fcpxml(t: ExportTimeline): string {
  const assets = new Map<string, { id: string; frames: number; video: boolean; audio: boolean; name: string }>();
  const asset = (file: string, frames: number, video: boolean, audio: boolean) => {
    const found = assets.get(file);
    if (found) return found.id;
    const id = `r${assets.size + 3}`;
    assets.set(file, { id, frames, video, audio, name: file.split("/").pop()!.replace(/\.[^.]+$/, "") });
    return id;
  };

  const spine: SpineItem[] = t.video.map((c) => ({ kind: "clip", item: c, offset: c.start, end: c.end }));
  const footageEnd = t.video.at(-1)?.end ?? 0;
  if (t.duration > footageEnd) spine.push({ kind: "gap", offset: footageEnd, end: t.duration });

  // Connected items hang off the spine item they start in; their offset
  // is in that item's local time (its start for a clip, 0 for the gap).
  const connected = new Map<SpineItem, string[]>();
  const attach = (at: number, el: (localOffset: string) => string) => {
    const host = spine.find((s) => at >= s.offset && at < s.end) ?? spine[spine.length - 1];
    const local = host.kind === "clip" ? host.item.in + (at - host.offset) : at - host.offset;
    connected.set(host, [...(connected.get(host) ?? []), el(rational(local))]);
  };

  for (const o of t.overlays) {
    const ref = asset(o.file, o.mediaFrames, true, false);
    attach(o.start, (off) => `<asset-clip ref="${ref}" lane="${o.layout === "fullFrame" ? 2 : 1}" offset="${off}" name="${xml(o.name)}" start="0s" duration="${rational(o.end - o.start)}"/>`);
  }
  for (const v of t.voiceover) {
    const ref = asset(v.file, v.mediaFrames, false, true);
    attach(v.start, (off) => `<asset-clip ref="${ref}" lane="-1" offset="${off}" name="${xml(v.name)}" start="0s" duration="${rational(v.end - v.start)}" audioRole="dialogue"/>`);
  }

  const items: string[] = [];
  spine.forEach((s, i) => {
    if (s.kind === "clip" && s.item.transitionIn && i > 0) {
      const tr = s.item.transitionIn;
      items.push(`<transition name="Cross Dissolve" offset="${rational(s.offset - tr / 2)}" duration="${rational(tr)}"><filter-video ref="r2" name="Cross Dissolve"/></transition>`);
    }
    const children = (connected.get(s) ?? []).join("");
    if (s.kind === "gap") {
      items.push(`<gap name="Gap" offset="${rational(s.offset)}" start="0s" duration="${rational(s.end - s.offset)}">${children}</gap>`);
      return;
    }
    const c = s.item;
    const ref = asset(c.file, c.mediaFrames, true, c.hasAudio);
    items.push(
      `<asset-clip ref="${ref}" offset="${rational(c.start)}" name="${xml(c.name)}" start="${rational(c.in)}" duration="${rational(c.end - c.start)}" tcFormat="NDF">` +
        `<adjust-conform type="fill"/>` +
        transform(c) +
        (c.hasAudio ? `<adjust-volume amount="${db(c.volume)}"/>` : "") +
        children +
        `</asset-clip>`
    );
  });

  const resources = [...assets.entries()]
    .map(([file, a]) =>
      `<asset id="${a.id}" name="${xml(a.name)}" start="0s" duration="${rational(a.frames)}" hasVideo="${a.video ? 1 : 0}" hasAudio="${a.audio ? 1 : 0}"` +
      (a.audio ? ` audioSources="1" audioChannels="2" audioRate="48000"` : "") +
      ` src="${xml(encodePath(file))}"/>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
<resources>
<format id="r1" name="FFVideoFormatRateUndefined" frameDuration="1/30s" width="${WIDTH}" height="${HEIGHT}" colorSpace="1-1-1 (Rec. 709)"/>
<effect id="r2" name="Cross Dissolve" uid="${DISSOLVE_UID}"/>
${resources}
</resources>
<library>
<event name="AutoCut">
<project name="${xml(t.name)}">
<sequence format="r1" duration="${rational(t.duration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
<spine>
${items.join("\n")}
</spine>
</sequence>
</project>
</event>
</library>
</fcpxml>
`;
}

/** Zoom keyframes in the clip's local time. Pans aren't written: see the export notes. */
function transform(c: VideoItem): string {
  if (c.motion.length < 2) {
    const s = c.motion[0]?.scale ?? 1;
    return s === 1 ? "" : `<adjust-transform scale="${s} ${s}"/>`;
  }
  const keys = c.motion.map((k) => `<keyframe time="${rational(c.in + k.frame)}" value="${k.scale} ${k.scale}"/>`).join("");
  return `<adjust-transform><param name="scale" key="2"><keyframeAnimation>${keys}</keyframeAnimation></param></adjust-transform>`;
}

function db(volume: number): string {
  if (volume <= 0.0001) return "-96dB";
  return `${(20 * Math.log10(volume)).toFixed(1)}dB`;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}
