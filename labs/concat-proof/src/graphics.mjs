// Motion graphics through Hyperframes. A graphic is {css, html, js}: either
// written by Claude (direct mode) or produced by a template below. It is
// wrapped into a 1080x1920 composition and rendered to ProRes 4444 .mov for
// overlays (Concat keeps its alpha; VP9 .webm loses it) or MP4 for full-frame
// cards. Renders are cached by content hash, so a review round only re-renders
// the graphics that changed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "./env.mjs";

const run = promisify(execFile);
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const FONT_NOTE = "Fonts installed for rendering: Inter (100-900 weights) and DejaVu Sans. Do not load web fonts.";

function documentFor(id, duration, { css, html, js }, opaque) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1080, height=1920" />
<script src="gsap.min.js"></script>
<style>
html, body { width: 1080px; height: 1920px; margin: 0; overflow: hidden; background: ${opaque ? "#000" : "transparent"}; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: Inter, "DejaVu Sans", sans-serif; }
${css}
</style></head>
<body>
<div id="root" data-composition-id="${id}" data-start="0" data-duration="${duration}" data-fps="30" data-width="1080" data-height="1920">
${html}
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
(function (tl, root) {
${js}
})(tl, document.getElementById("root"));
tl.set({}, {}, ${duration});
window.__timelines["${id}"] = tl;
</script>
</body></html>`;
}

/** Renders a graphic; returns {file, ms, cached}. Throws with Hyperframes' log tail on failure. */
export async function renderGraphic(g, code, workDir) {
  const opaque = g.layout === "fullFrame";
  const id = g.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const doc = documentFor(id, g.duration, code, opaque);
  const hash = createHash("sha256").update(doc).digest("hex").slice(0, 12);
  const dir = join(workDir, "hf", `${id}-${hash}`);
  const file = join(workDir, "renders", `${id}-${hash}.${opaque ? "mp4" : "mov"}`);
  if (existsSync(file)) return { file, ms: 0, cached: true };
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(workDir, "renders"), { recursive: true });
  writeFileSync(join(dir, "index.html"), doc);
  copyFileSync(env.gsap, join(dir, "gsap.min.js"));
  const t0 = performance.now();
  try {
    await run(env.hfBin, ["render", "--format", opaque ? "mp4" : "mov", "--output", file], { cwd: dir, env: env.hfEnv, maxBuffer: 1 << 26, timeout: 600_000 });
  } catch (e) {
    throw new Error(`Hyperframes render of ${g.id} failed: ${String(e.stdout ?? "").slice(-1500)}${String(e.stderr ?? "").slice(-1500)}`);
  }
  return { file, ms: Math.round(performance.now() - t0), cached: false };
}

// ---- Templates (template mode). Each returns {css, html, js}. ----
export const TEMPLATES = {
  hookPill: ({ headline = "", sub = "", accent = "#ff4628" }) => ({
    css: `.pill{position:absolute;left:80px;right:80px;top:300px;padding:44px 52px;border-radius:44px;background:${accent};
      color:#fff;text-align:center;font:900 96px/1.05 Inter;box-shadow:0 24px 64px rgba(0,0,0,.35)}
      .sub{position:absolute;left:60px;right:60px;top:640px;text-align:center;color:#fff;font:700 60px/1.15 Inter;text-shadow:0 4px 18px rgba(0,0,0,.85)}`,
    html: `<div class="pill" id="pill">${esc(headline)}</div><div class="sub" id="sub">${esc(sub)}</div>`,
    js: `tl.fromTo("#pill",{scale:.6,opacity:0},{scale:1,opacity:1,duration:.35,ease:"back.out(2)"},0);
      tl.fromTo("#sub",{y:50,opacity:0},{y:0,opacity:1,duration:.3},.25);
      tl.to(["#pill","#sub"],{opacity:0,duration:.25},Math.max(.6, ${"__DUR__"}-.3));`,
  }),
  callout: ({ text = "", accent = "#ffd23f" }) => ({
    css: `.c{position:absolute;left:0;right:0;top:420px;text-align:center}
      .c span{display:inline-block;padding:26px 44px;border-radius:24px;background:${accent};color:#111;font:900 84px/1 Inter;transform:rotate(-3deg)}`,
    html: `<div class="c"><span id="c">${esc(text)}</span></div>`,
    js: `tl.fromTo("#c",{scale:0,opacity:0},{scale:1,opacity:1,duration:.3,ease:"back.out(2.5)"},0);
      tl.to("#c",{scale:0.9,opacity:0,duration:.2},Math.max(.5, ${"__DUR__"}-.25));`,
  }),
  endCard: ({ headline = "", sub = "", cta = "", bg = "#14110f", accent = "#ff4628" }) => ({
    css: `#bg{position:absolute;inset:0;background:${bg}}
      .h{position:absolute;left:80px;right:80px;top:640px;text-align:center;color:#fff;font:900 112px/1.02 Inter}
      .s{position:absolute;left:80px;right:80px;top:960px;text-align:center;color:#d8d2cc;font:600 56px/1.2 Inter}
      .cta{position:absolute;left:50%;top:1240px;transform:translateX(-50%);padding:34px 70px;border-radius:999px;background:${accent};color:#fff;font:800 64px Inter;white-space:nowrap}`,
    html: `<div id="bg"></div><div class="h" id="h">${esc(headline)}</div><div class="s" id="s">${esc(sub)}</div><div class="cta" id="cta">${esc(cta)}</div>`,
    js: `tl.fromTo("#bg",{opacity:0},{opacity:1,duration:.3},0);
      tl.fromTo("#h",{y:60,opacity:0},{y:0,opacity:1,duration:.4,ease:"power3.out"},.15);
      tl.fromTo("#s",{y:40,opacity:0},{y:0,opacity:1,duration:.35},.4);
      tl.fromTo("#cta",{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(2)"},.65);`,
  }),
};

/** The {css, html, js} a plan graphic resolves to in either mode. */
export function codeFor(g) {
  if (g.code) return g.code;
  const make = TEMPLATES[g.template?.name];
  if (!make) throw new Error(`graphic ${g.id}: unknown template ${g.template?.name}`);
  // Empty props fall back to the template defaults.
  const c = make(Object.fromEntries(Object.entries(g.template.props ?? {}).filter(([, v]) => v)));
  return { ...c, js: c.js.replaceAll("__DUR__", String(g.duration)) };
}
