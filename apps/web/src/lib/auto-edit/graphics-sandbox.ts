import type { PlanGraphic, TemplateName } from "./plan-schema";

/**
 * Motion graphics are {css, html, js} rendered by Hyperframes in
 * headless Chromium. In clean mode they come from the templates below;
 * in designed mode Claude writes them, so they are untrusted code and
 * run behind four layers:
 * 1. checkGraphicCode(): a size cap and a refusal list (network APIs,
 *    timers, randomness, script/iframe tags, remote URLs). A graphic
 *    that fails falls back to its template, never back to Claude.
 * 2. A Content-Security-Policy in the document: no connections, no
 *    remote images, fonts or frames.
 * 3. The browser itself is started through a wrapper that refuses
 *    every non-loopback request (toolchain.ts, CHROME_SANDBOX_FLAGS).
 * 4. A render time limit (graphics-render.ts).
 * A graphic that fails to render also falls back to its template.
 */

export const GRAPHIC_CODE_MAX_CHARS = 12_000;

const JS_REFUSED: [RegExp, string][] = [
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/, "network access"],
  [/\b(importScripts|Worker|SharedWorker|ServiceWorker|serviceWorker)\b/, "workers"],
  [/\bimport\s*\(|\brequire\s*\(/, "module loading"],
  [/\b(eval|Function)\s*\(|\bnew\s+Function\b/, "eval"],
  [/\b(location|navigator|cookie|localStorage|sessionStorage|indexedDB|caches)\b/, "browser state"],
  [/\b(window|document)\s*\.\s*open\s*\(|\bopen\s*\(/, "opening windows"],
  [/\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\b/, "timers (drive everything from tl)"],
  [/\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/, "time or randomness (renders must be deterministic)"],
  [/<\s*\/\s*script/i, "closing the script tag"],
  [/\bsrc\s*=|\bhref\s*=|\.src\b|\.href\b|innerHTML\s*=\s*[^;]*<\s*(script|iframe|img|link)/i, "loading resources"],
];

const HTML_REFUSED: [RegExp, string][] = [
  [/<\s*(script|iframe|frame|object|embed|link|meta|base|form|portal|audio|video|source|img)\b/i, "disallowed element"],
  [/\son[a-z]+\s*=/i, "inline event handler"],
  [/(src|href|srcset|action|poster|data)\s*=\s*["']?\s*(https?:|\/\/|javascript:)/i, "remote or script URL"],
  [/<\s*style\b/i, "style tag (put CSS in css)"],
];

const CSS_REFUSED: [RegExp, string][] = [
  [/</, "markup in CSS"],
  [/@import/i, "@import"],
  [/url\s*\(\s*["']?\s*(?!data:)/i, "url() other than data:"],
  [/expression\s*\(|behavior\s*:|-moz-binding/i, "legacy script hooks"],
];

/** Sandbox problems in Claude-written graphic code; empty when it may render. */
export function checkGraphicCode(code: { css: string; html: string; js: string }): string[] {
  const p: string[] = [];
  const size = code.css.length + code.html.length + code.js.length;
  if (size > GRAPHIC_CODE_MAX_CHARS) p.push(`code is ${size} characters, over the ${GRAPHIC_CODE_MAX_CHARS} cap`);
  for (const [re, why] of JS_REFUSED) if (re.test(code.js)) p.push(`js: ${why}`);
  for (const [re, why] of HTML_REFUSED) if (re.test(code.html)) p.push(`html: ${why}`);
  for (const [re, why] of CSS_REFUSED) if (re.test(code.css)) p.push(`css: ${why}`);
  if (!code.js.trim()) p.push("js: empty timeline");
  return p;
}

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const FONT_NOTE = "Fonts installed for rendering: Inter (100-900 weights) and DejaVu Sans. Do not load web fonts.";

/**
 * The composition for one graphic. For the worker, Hyperframes serves it
 * with gsap.min.js next to it. For the live preview (`inline`), the
 * browser runs it in an iframe sandboxed to scripts only, with GSAP and
 * Inter inlined, connections refused outright, and a listener the editor
 * uses to seek the timeline to the playhead.
 */
export function documentFor(
  id: string,
  duration: number,
  code: { css: string; html: string; js: string },
  opaque: boolean,
  inline?: { gsap: string; interWoff2DataUrl?: string }
): string {
  const csp = inline ? CSP.replace("connect-src 'self'", "connect-src 'none'").replace("font-src 'self' data:", "font-src data:") : CSP;
  const gsapTag = inline ? `<script>${inline.gsap.replace(/<\/script/gi, "<\\/script")}</script>` : `<script src="gsap.min.js"></script>`;
  const font = inline?.interWoff2DataUrl
    ? `@font-face { font-family: Inter; src: url(${inline.interWoff2DataUrl}) format("woff2"); font-weight: 100 900; }`
    : "";
  const seek = inline
    ? `window.addEventListener("message", function (e) { var d = e.data; if (d && d.type === "seek" && typeof d.t === "number") tl.seek(Math.max(0, Math.min(d.t, ${duration})), false); });`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=1080, height=1920" />
${gsapTag}
<style>
${font}
html, body { width: 1080px; height: 1920px; margin: 0; overflow: hidden; background: ${opaque ? "#000" : "transparent"}; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: Inter, "DejaVu Sans", sans-serif; }
${code.css}
</style></head>
<body>
<div id="root" data-composition-id="${id}" data-start="0" data-duration="${duration}" data-fps="30" data-width="1080" data-height="1920">
${code.html}
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
(function (tl, root) {
${code.js}
})(tl, document.getElementById("root"));
tl.set({}, {}, ${duration});
window.__timelines["${id}"] = tl;
${seek}
</script>
</body></html>`;
}

const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// Colours land inside CSS; anything that isn't a plain colour is replaced.
const colour = (s: string | undefined, fallback: string) =>
  s && /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(s.trim()) ? s.trim() : fallback;

type Props = Partial<Record<"headline" | "sub" | "text" | "cta" | "bg" | "accent", string>>;

/** Clean mode's templates; each returns {css, html, js} for a graphic of `dur` seconds. */
export const TEMPLATES: Record<TemplateName, (p: Props, dur: number) => { css: string; html: string; js: string }> = {
  hookPill: (p, dur) => ({
    css: `.pill{position:absolute;left:80px;right:80px;top:300px;padding:44px 52px;border-radius:44px;background:${colour(p.accent, "#ff4628")};
      color:#fff;text-align:center;font:900 96px/1.05 Inter;box-shadow:0 24px 64px rgba(0,0,0,.35)}
      .sub{position:absolute;left:60px;right:60px;top:640px;text-align:center;color:#fff;font:700 60px/1.15 Inter;text-shadow:0 4px 18px rgba(0,0,0,.85)}`,
    html: `<div class="pill" id="pill">${esc(p.headline)}</div><div class="sub" id="sub">${esc(p.sub)}</div>`,
    js: `tl.fromTo("#pill",{scale:.6,opacity:0},{scale:1,opacity:1,duration:.35,ease:"back.out(2)"},0);
      tl.fromTo("#sub",{y:50,opacity:0},{y:0,opacity:1,duration:.3},.25);
      tl.to(["#pill","#sub"],{opacity:0,duration:.25},${Math.max(0.6, dur - 0.3)});`,
  }),
  callout: (p, dur) => ({
    css: `.c{position:absolute;left:0;right:0;top:420px;text-align:center}
      .c span{display:inline-block;padding:26px 44px;border-radius:24px;background:${colour(p.accent, "#ffd23f")};color:#111;font:900 84px/1 Inter;transform:rotate(-3deg)}`,
    html: `<div class="c"><span id="c">${esc(p.text)}</span></div>`,
    js: `tl.fromTo("#c",{scale:0,opacity:0},{scale:1,opacity:1,duration:.3,ease:"back.out(2.5)"},0);
      tl.to("#c",{scale:0.9,opacity:0,duration:.2},${Math.max(0.5, dur - 0.25)});`,
  }),
  endCard: (p) => ({
    css: `#bg{position:absolute;inset:0;background:${colour(p.bg, "#14110f")}}
      .h{position:absolute;left:80px;right:80px;top:640px;text-align:center;color:#fff;font:900 112px/1.02 Inter}
      .s{position:absolute;left:80px;right:80px;top:960px;text-align:center;color:#d8d2cc;font:600 56px/1.2 Inter}
      .cta{position:absolute;left:50%;top:1240px;transform:translateX(-50%);padding:34px 70px;border-radius:999px;background:${colour(p.accent, "#ff4628")};color:#fff;font:800 64px Inter;white-space:nowrap}`,
    html: `<div id="bg"></div><div class="h" id="h">${esc(p.headline)}</div><div class="s" id="s">${esc(p.sub)}</div><div class="cta" id="cta">${esc(p.cta)}</div>`,
    js: `tl.fromTo("#bg",{opacity:0},{opacity:1,duration:.3},0);
      tl.fromTo("#h",{y:60,opacity:0},{y:0,opacity:1,duration:.4,ease:"power3.out"},.15);
      tl.fromTo("#s",{y:40,opacity:0},{y:0,opacity:1,duration:.35},.4);
      tl.fromTo("#cta",{scale:.5,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(2)"},.65);`,
  }),
};

/** The template version of a graphic (clean mode, and designed mode's fallback). */
export function templateCode(g: PlanGraphic): { css: string; html: string; js: string } {
  // Empty props fall back to the template defaults.
  const props = Object.fromEntries(Object.entries(g.template.props).filter(([, v]) => v)) as Props;
  return TEMPLATES[g.template.name](props, g.duration);
}

export type ResolvedGraphic = {
  code: { css: string; html: string; js: string };
  source: "designed" | "template";
  /** Why a designed graphic fell back to its template. */
  fallbackReasons: string[];
};

/** What actually renders for a graphic before any render attempt: Claude's code when it passes the sandbox checks, else its template. */
export function resolveGraphic(g: PlanGraphic): ResolvedGraphic {
  if (!g.code) return { code: templateCode(g), source: "template", fallbackReasons: [] };
  const problems = checkGraphicCode(g.code);
  if (problems.length) return { code: templateCode(g), source: "template", fallbackReasons: problems };
  return { code: g.code, source: "designed", fallbackReasons: [] };
}
