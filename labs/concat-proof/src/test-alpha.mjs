// Goal 2: does a transparent Hyperframes overlay composite over footage in Concat?
// For each overlay variant: footage on T1, overlay on T2, preview.frame at t,
// then compare against a footage-only frame. Usage:
//   node test-alpha.mjs <workdir> <footage.mp4> <overlayDir>
// overlayDir holds hook.mov, hook.webm, hook_still.png, hook.mp4 (opaque, black bg).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Concat } from "./concat.mjs";
import { env } from "./env.mjs";

const [work, footage, ovDir] = process.argv.slice(2);
const T = 1.5;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const cc = new Concat({ bin: env.concatBin, env: env.concatEnv, cwd: env.concatCwd });

async function project(name, build) {
  const path = join(work, name);
  await cc.call("project.create", { location: work, name, video: { width: 1080, height: 1920, rateNum: 30, rateDen: 1 } });
  const fm = (await cc.call("media.import", { path, file: footage })).createdId;
  await cc.apply(path, { op: "addClip", mediaId: fm, trackId: "T1", start: 0 });
  if (build) await build(path);
  const png = join(work, `${name}.png`);
  await cc.call("preview.frame", { path, time: T, output: png });
  return { path, png };
}

async function overlay(file, patch) {
  return async (path) => {
    const m = (await cc.call("media.import", { path, file })).createdId;
    const v = await cc.apply(path, { op: "addClip", mediaId: m, trackId: "T2", start: 0 });
    if (patch) await cc.apply(path, { op: "updateClip", clipId: v.createdId, patch });
  };
}

const results = {};
const ref = await project("ref");
const variants = {
  prores4444_mov: await overlay(join(ovDir, "hook.mov")),
  vp9alpha_webm: await overlay(join(ovDir, "hook.webm")),
  png_still: await overlay(join(ovDir, "hook_still.png")),
  opaque_mp4_screen: await overlay(join(ovDir, "hook.mp4"), { blend: "screen" }),
  opaque_mp4_normal: await overlay(join(ovDir, "hook.mp4")),
  concat_title: async (path) => {
    await cc.apply(path, { op: "addTextClip", trackId: "T2", start: 0, duration: 3, offsetY: -0.25,
      style: { content: "STOP SCROLLING", fontSize: 0.055, fontWeight: 900, color: "#ffffff", background: "#ff4628eb",
        backgroundRadius: 0.4, backgroundPaddingX: 0.04, backgroundPaddingY: 0.02, maxWidth: 0.85 } });
  },
};
for (const [name, build] of Object.entries(variants)) {
  const t0 = performance.now();
  try {
    const r = await project(name, build);
    results[name] = { png: r.png, previewMs: Math.round(performance.now() - t0) };
  } catch (e) {
    results[name] = { error: String(e.message) };
  }
}

// Export the ProRes variant as the transparency test clip.
const t0 = performance.now();
await cc.export({ path: join(work, "prores4444_mov"), output: join(work, "alpha-test-prores.mp4"), codec: "h264", crf: 20, preset: "veryfast" });
results.exportMs = Math.round(performance.now() - t0);
await cc.close();

// Compare each composited frame against the footage-only reference.
const cmp = execFileSync("python3", ["-I", join(import.meta.dirname, "compare_alpha.py"), ref.png,
  ...Object.values(results).filter((r) => r?.png).map((r) => r.png)], { encoding: "utf8" });
results.compare = JSON.parse(cmp);
writeFileSync(join(work, "alpha-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
