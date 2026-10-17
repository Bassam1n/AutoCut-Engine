import { describe, expect, it } from "vitest";
import { parseProbe } from "./context";
import { parseMp4Header } from "./mp4-header";
import { footageLabel, footageShortLabel, isUploadIndex } from "./plan-schema";

/** One MP4 box: 32-bit size, 4-char type, payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  let at = 8;
  for (const p of payload) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function mvhd(timescale: number, duration: number): Uint8Array {
  const b = new Uint8Array(100); // version 0
  const v = new DataView(b.buffer);
  v.setUint32(12, timescale);
  v.setUint32(16, duration);
  return b;
}

function tkhd(width: number, height: number): Uint8Array {
  const b = new Uint8Array(84);
  const v = new DataView(b.buffer);
  v.setUint32(76, width * 65536);
  v.setUint32(80, height * 65536);
  return b;
}

describe("parseMp4Header (clips the browser can't play)", () => {
  it("reads the length and the video track's size, skipping the audio track", () => {
    const file = new Uint8Array([
      ...box("ftyp", new Uint8Array(8)),
      ...box("mdat", new Uint8Array(32)),
      ...box("moov", box("mvhd", mvhd(600, 4230)), box("trak", box("tkhd", tkhd(0, 0))), box("trak", box("tkhd", tkhd(1920, 1080)))),
    ]);
    expect(parseMp4Header(file.buffer)).toEqual({ duration: 7.05, width: 1920, height: 1080 });
  });

  it("returns null for something that isn't a movie", () => {
    expect(parseMp4Header(new TextEncoder().encode("not a video at all").buffer)).toBeNull();
    expect(parseMp4Header(box("moov", box("trak")).buffer as ArrayBuffer)).toBeNull();
  });
});

describe("parseProbe", () => {
  const probe = (rotation?: number) => ({
    format: { duration: "4.0" },
    streams: [
      { codec_type: "video", width: 1920, height: 1080, ...(rotation != null ? { side_data_list: [{ rotation }] } : {}) },
      { codec_type: "audio" },
    ],
  });

  it("reports the display size of a phone clip stored rotated", () => {
    expect(parseProbe(probe(-90), "a.mov")).toEqual({ duration: 4, width: 1080, height: 1920, hasAudio: true });
    expect(parseProbe(probe(90), "a.mov")).toMatchObject({ width: 1080, height: 1920 });
    expect(parseProbe(probe(180), "a.mov")).toMatchObject({ width: 1920, height: 1080 });
    expect(parseProbe(probe(), "a.mov")).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("footage labels", () => {
  it("numbers scenes from 1 and uploads from 1", () => {
    expect([footageLabel(0), footageShortLabel(2), footageLabel(1000), footageShortLabel(1003)]).toEqual(["Scene 1", "S3", "Upload 1", "U4"]);
    expect([isUploadIndex(999), isUploadIndex(1000)]).toEqual([false, true]);
  });
});
