import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import cleanFixture from "../__fixtures__/clean-plan.json";
import designedFixture from "../__fixtures__/designed-plan.json";
import { EditPlan } from "../plan-schema";
import { EXPORT_FORMATS, exportText, srt } from "./bundle";
import { fcp7Xml } from "./fcp7";
import { fcpxml } from "./fcpxml";
import { otioJson } from "./otio";
import { buildExportTimeline, rational, timecode, type ExportMedia } from "./timeline";

/**
 * Export writers against the proof's two plans. Set EXPORT_FIXTURE_DIR to
 * also write the files out: CI then re-imports them with OpenTimelineIO's
 * adapters (scripts/validate-exports.py), which is the independent check
 * that the XML is what those formats' readers expect.
 */

const media = (plan: EditPlan, withVo = false): ExportMedia => ({
  scenes: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, { file: `media/scene-0${i + 1}.mp4`, duration: 6.04, width: 720, height: 1280, hasAudio: true }])),
  voiceovers: withVo ? { 1: { file: "media/voiceover-scene-02.mp3", duration: 3.2 } } : {},
  graphics: Object.fromEntries(plan.graphics.map((g) => [g.id, { file: `media/graphic-${g.id}.${g.layout === "overlay" ? "mov" : "mp4"}`, duration: g.duration, alpha: g.layout === "overlay" }])),
});

const clean = () => EditPlan.parse(structuredClone(cleanFixture));
const designed = () => {
  const p = EditPlan.parse(structuredClone(designedFixture));
  p.clips[2].transitionIn = { type: "cross-fade", duration: 0.4 };
  return p;
};

describe("export timeline", () => {
  it("rounds to frames and keeps clips abutted", () => {
    const t = buildExportTimeline(clean(), media(clean()), "Ad");
    expect(t.duration).toBe(900);
    t.video.forEach((c, i) => {
      if (i > 0) expect(c.start).toBe(t.video[i - 1].end);
      expect(c.out - c.in).toBe(c.end - c.start);
    });
    expect(t.video.at(-1)!.end + 90).toBe(t.duration); // 3 s end card hold
  });

  it("formats rational times and timecode", () => {
    expect(rational(45)).toBe("3/2s");
    expect(rational(60)).toBe("2s");
    expect(timecode(30 * 61 + 5)).toBe("00:01:01:05");
  });
});

describe("Premiere (FCP 7 XML)", () => {
  it("writes footage, graphics and voiceover tracks with relative media", () => {
    const p = designed();
    const x = fcp7Xml(buildExportTimeline(p, media(p, true), "Cold brew"));
    expect(x).toContain('<xmeml version="4">');
    expect(x.match(/<track>/g)).toHaveLength(5);
    expect(x).toContain("<pathurl>media/scene-01.mp4</pathurl>");
    expect(x).toContain("<effectid>Cross Dissolve</effectid>");
    expect(x).toContain("<pathurl>media/voiceover-scene-02.mp3</pathurl>");
    // 720x1280 scenes fill 1080x1920 at 150%; the plan's 1.08 zoom is 162%.
    expect(x).toMatch(/<parameterid>scale<\/parameterid>.*?<value>150<\/value>/);
  });
});

describe("Resolve / Final Cut Pro (FCPXML)", () => {
  it("puts graphics on lanes and transitions in the spine", () => {
    const p = designed();
    const x = fcpxml(buildExportTimeline(p, media(p, true), "Cold brew"));
    expect(x).toContain('<fcpxml version="1.8">');
    expect(x).toContain('width="1080" height="1920"');
    expect(x).toMatch(/<transition name="Cross Dissolve" offset="[^"]+" duration="2\/5s">/);
    expect(x).toMatch(/lane="1"/);
    expect(x).toMatch(/lane="2"/);
    expect(x).toMatch(/lane="-1"[^>]*audioRole="dialogue"/);
    expect(x).toContain("<keyframeAnimation>");
  });

  it("writes an end card that runs past the footage onto a gap", () => {
    const p = clean();
    const x = fcpxml(buildExportTimeline(p, media(p), "Ad"));
    expect(x).toMatch(/<gap name="Gap" offset="[^"]+" start="0s" duration="3s"><asset-clip [^>]*lane="2"/);
  });
});

describe("OTIO", () => {
  it("is valid JSON with five tracks", () => {
    const p = designed();
    const j = JSON.parse(otioJson(buildExportTimeline(p, media(p, true), "Ad")));
    expect(j.OTIO_SCHEMA).toBe("Timeline.1");
    expect(j.tracks.children.map((t: { name: string }) => t.name)).toEqual(["V1 Footage", "V2 Graphics", "V3 Cards", "A1 Footage", "A2 Voiceover"]);
    expect(j.tracks.children[0].children.some((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === "Transition.1")).toBe(true);
  });
});

describe("bundles", () => {
  it("writes an SRT of the captions", () => {
    const p = clean();
    const s = srt(buildExportTimeline(p, media(p), "Ad"));
    expect(s.startsWith("1\n00:00:")).toBe(true);
    expect(s.split("-->")).toHaveLength(p.captions.length + 1);
  });

  it("cuts and numbers CapCut shots in timeline order", () => {
    const p = clean();
    const out = exportText("capcut", p, media(p), "Ad");
    expect(out.capcutCuts.map((c) => c.out)).toEqual(["media/001 Scene 1.mp4", "media/002 Scene 2.mp4", "media/003 Scene 3.mp4", "media/004 Scene 5.mp4", "media/005 Scene 6.mp4"]);
    expect(out.capcutCuts[0]).toMatchObject({ source: "media/scene-01.mp4", fromSeconds: 0.3, toSeconds: 5.8 });
    expect(out.files.map((f) => f.path)).toEqual(["captions.srt", "timeline.txt", "README.txt"]);
  });

  it("writes every format's project file and a readme", () => {
    const p = designed();
    for (const format of EXPORT_FORMATS) {
      const out = exportText(format, p, media(p, true), "Cold brew");
      expect(out.files.some((f) => f.path === "README.txt")).toBe(true);
      expect(out.notes.length).toBeGreaterThan(0);
    }
  });

  it("writes fixtures for the OpenTimelineIO re-import check", () => {
    const dir = process.env.EXPORT_FIXTURE_DIR;
    if (!dir) return;
    for (const [label, plan, withVo] of [["clean", clean(), false], ["designed", designed(), true]] as const) {
      const t = buildExportTimeline(plan, media(plan, withVo), label);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${label}.xml`), fcp7Xml(t));
      writeFileSync(join(dir, `${label}.fcpxml`), fcpxml(t));
      writeFileSync(join(dir, `${label}.otio`), otioJson(t));
      writeFileSync(
        join(dir, `${label}.expected.json`),
        JSON.stringify({
          duration: t.duration,
          video: t.video.map((c) => ({ name: c.name, file: c.file, in: c.in, duration: c.end - c.start, transitionIn: c.transitionIn })),
          overlays: t.overlays.map((o) => ({ name: o.name, start: o.start, duration: o.end - o.start, layout: o.layout })),
          voiceover: t.voiceover.map((v) => ({ start: v.start, duration: v.end - v.start })),
        })
      );
    }
  });
});
