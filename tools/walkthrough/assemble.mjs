// Stitches out/raw/NN-*.webm (one per chapter, in name order) into
// out/autocut-walkthrough.mp4 (H.264 1080p, web-friendly), and writes
// out/chapters.txt with YouTube-style timestamps from each chapter's
// real duration. Chapter titles come from out/raw/NN-*.json sidecars
// that record.mjs writes.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const RAW = new URL("./out/raw/", import.meta.url).pathname;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const clips = readdirSync(RAW).filter((f) => f.endsWith(".webm")).sort();
if (clips.length === 0) throw new Error("No clips in out/raw. Run record.mjs first.");

const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

const stamp = (s) => {
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};

// Normalise each clip first (webm from Playwright has variable frame
// timing), then concat losslessly.
const normalized = [];
let t = 0;
const chapterLines = [];
for (const clip of clips) {
  const src = join(RAW, clip);
  const dst = join(RAW, clip.replace(/\.webm$/, ".mp4"));
  const meta = existsSync(src.replace(/\.webm$/, ".json")) ? JSON.parse(readFileSync(src.replace(/\.webm$/, ".json"), "utf8")) : {};
  const base = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xfaf9f6,fps=30,format=yuv420p";
  const speedups = (meta.speedups ?? []).filter((r) => r.end - r.start > 2).sort((a, b) => a.start - b.start);
  const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-an"];
  if (speedups.length === 0) {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", base, ...encode, dst]);
  } else {
    // Cut into normal / fast segments, speed the fast ones 8x, rejoin.
    // One ffmpeg pass per segment: a single filter graph that trims the
    // same input several times buffers the whole decoded clip in memory.
    const segs = [];
    let cursor = 0;
    for (const r of speedups) {
      if (r.start > cursor) segs.push({ a: cursor, b: r.start, fast: false });
      segs.push({ a: r.start, b: r.end, fast: true });
      cursor = r.end;
    }
    segs.push({ a: cursor, b: null, fast: false });
    const segFiles = segs.map((g, i) => {
      const out = dst.replace(/\.mp4$/, `.seg${i}.mp4`);
      const range = ["-ss", String(g.a), ...(g.b === null ? [] : ["-to", String(g.b)])];
      execFileSync("ffmpeg", ["-y", "-v", "error", ...range, "-i", src,
        "-vf", `setpts=${g.fast ? "(PTS-STARTPTS)/8" : "PTS-STARTPTS"},${base}`, ...encode, out]);
      return out;
    });
    const segList = dst.replace(/\.mp4$/, ".segs.txt");
    writeFileSync(segList, segFiles.map((f) => `file '${f}'`).join("\n"));
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", segList, "-c", "copy", dst]);
    for (const f of [...segFiles, segList]) rmSync(f);
  }
  if (meta.title) chapterLines.push(`${stamp(t)} ${meta.title}`);
  t += duration(dst);
  normalized.push(dst);
}

const list = join(RAW, "concat.txt");
writeFileSync(list, normalized.map((f) => `file '${f}'`).join("\n"));
const final = join(OUT, "autocut-walkthrough.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final]);
writeFileSync(join(OUT, "chapters.txt"), chapterLines.join("\n") + "\n");

console.log(`Wrote ${final} (${stamp(t)}) with ${clips.length} chapters.`);
console.log(chapterLines.join("\n"));
