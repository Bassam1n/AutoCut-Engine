import { FPS, HEIGHT, WIDTH, xml, type ExportTimeline, type VideoItem } from "./timeline";

/**
 * Premiere Pro: Final Cut Pro 7 XML ("xmeml"), the interchange format
 * Premiere imports (File > Import). Clip items, trims, tracks, the
 * voiceover, cross dissolves and Basic Motion (scale and centre
 * keyframes for Ken Burns moves). Captions travel separately as SRT.
 *
 * Layout follows what OpenTimelineIO's fcp_xml adapter writes and reads:
 * a clip next to a transition has start or end -1 and its in or out
 * extended into the handle by half the transition. Media paths are
 * relative to the XML file, so the bundle relinks wherever it's unzipped.
 */

const RATE = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;

export function fcp7Xml(t: ExportTimeline): string {
  const files = new Map<string, string>(); // relative path -> file id
  const fileEl = (path: string, frames: number, kind: { video?: { w: number; h: number }; audio?: boolean }) => {
    const existing = files.get(path);
    if (existing) return `<file id="${existing}"/>`;
    const id = `file-${files.size + 1}`;
    files.set(path, id);
    const name = path.split("/").pop()!;
    const video = kind.video
      ? `<video><samplecharacteristics>${RATE}<width>${kind.video.w}</width><height>${kind.video.h}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>`
      : "";
    const audio = kind.audio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>` : "";
    return `<file id="${id}"><name>${xml(name)}</name><pathurl>${xml(encodePath(path))}</pathurl>${RATE}<duration>${frames}</duration><media>${video}${audio}</media></file>`;
  };

  let clipId = 0;
  const v1: string[] = [];
  t.video.forEach((c, i) => {
    const next = t.video[i + 1];
    const headT = c.transitionIn;
    const tailT = next?.transitionIn ?? 0;
    if (headT) {
      v1.push(`<transitionitem><start>${c.start - headT / 2}</start><end>${c.start + headT / 2}</end><alignment>center</alignment>${RATE}<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>`);
    }
    v1.push(
      `<clipitem id="clipitem-${++clipId}"><name>${xml(c.name)}</name><enabled>TRUE</enabled><duration>${c.mediaFrames}</duration>${RATE}` +
        `<start>${headT ? -1 : c.start}</start><end>${tailT ? -1 : c.end}</end>` +
        `<in>${c.in - headT / 2}</in><out>${c.out + tailT / 2}</out>` +
        fileEl(c.file, c.mediaFrames, { video: sceneSize(c), audio: c.hasAudio }) +
        motionFilter(c) +
        `</clipitem>`
    );
  });

  const overlayTrack = (layout: "overlay" | "fullFrame") =>
    t.overlays
      .filter((o) => o.layout === layout)
      .map((o) =>
        `<clipitem id="clipitem-${++clipId}"><name>${xml(o.name)}</name><enabled>TRUE</enabled><duration>${o.mediaFrames}</duration>${RATE}` +
        `<start>${o.start}</start><end>${o.end}</end><in>0</in><out>${o.end - o.start}</out>` +
        fileEl(o.file, o.mediaFrames, { video: { w: WIDTH, h: HEIGHT } }) +
        (o.alpha ? `<alphatype>straight</alphatype>` : "") +
        `</clipitem>`
      )
      .join("");

  const a1 = t.video
    .filter((c) => c.hasAudio)
    .map((c) =>
      `<clipitem id="clipitem-${++clipId}"><name>${xml(c.name)}</name><enabled>TRUE</enabled><duration>${c.mediaFrames}</duration>${RATE}` +
      `<start>${c.start}</start><end>${c.end}</end><in>${c.in}</in><out>${c.out}</out>` +
      fileEl(c.file, c.mediaFrames, { video: sceneSize(c), audio: true }) +
      `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` +
      levelFilter(c.volume) +
      `</clipitem>`
    )
    .join("");

  const a2 = t.voiceover
    .map((v) =>
      `<clipitem id="clipitem-${++clipId}"><name>${xml(v.name)}</name><enabled>TRUE</enabled><duration>${v.mediaFrames}</duration>${RATE}` +
      `<start>${v.start}</start><end>${v.end}</end><in>0</in><out>${v.end - v.start}</out>` +
      fileEl(v.file, v.mediaFrames, { audio: true }) +
      `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` +
      `</clipitem>`
    )
    .join("");

  const format = `<format><samplecharacteristics>${RATE}<width>${WIDTH}</width><height>${HEIGHT}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`;
  const track = (items: string) => `<track>${items}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<project><name>${xml(t.name)}</name><children>
<sequence id="sequence-1"><name>${xml(t.name)}</name><duration>${t.duration}</duration>${RATE}
<timecode>${RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>${format}${track(v1.join(""))}${track(overlayTrack("overlay"))}${track(overlayTrack("fullFrame"))}</video>
<audio><numOutputChannels>2</numOutputChannels>${track(a1)}${track(a2)}</audio>
</media>
</sequence>
</children></project>
</xmeml>
`;
}

// The engine fills the vertical frame with each scene; Premiere scales
// from the clip's own size, so the engine's 1.0 is this fill factor.
const sceneSize = (c: VideoItem) => ({ w: c.width, h: c.height });

function motionFilter(c: VideoItem): string {
  const { w, h } = sceneSize(c);
  const fill = Math.max(WIDTH / w, HEIGHT / h) * 100;
  const keys = c.motion.length ? c.motion : [{ frame: 0, scale: 1, offsetX: 0, offsetY: 0 }];
  const first = keys[0];
  const when = (frame: number) => c.in + frame; // FCP 7 keyframes count in source frames
  const pct = (s: number) => +(s * fill).toFixed(3);
  const scaleKeys = c.motion.length > 1 ? keys.map((k) => `<keyframe><when>${when(k.frame)}</when><value>${pct(k.scale)}</value></keyframe>`).join("") : "";
  const centerKeys = c.motion.length > 1
    ? keys.map((k) => `<keyframe><when>${when(k.frame)}</when><value><horiz>${k.offsetX}</horiz><vert>${k.offsetY}</vert></value></keyframe>`).join("")
    : "";
  return (
    `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
    `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${pct(first.scale)}</value>${scaleKeys}</parameter>` +
    `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>${first.offsetX}</horiz><vert>${first.offsetY}</vert></value>${centerKeys}</parameter>` +
    `</effect></filter>`
  );
}

function levelFilter(volume: number): string {
  return `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${+volume.toFixed(3)}</value></parameter></effect></filter>`;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}
