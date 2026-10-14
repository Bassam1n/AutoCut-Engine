// Shared helpers for the walkthrough recorder: password sign-in that
// writes @supabase/ssr cookies, an on-page overlay (fake cursor with
// click ripple, caption bar, chapter cards), and eased cursor motion.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error("Playwright not found (npm i -D playwright, or use /opt/node-tools).");
}
export const { chromium } = loadPlaywright();

export const APP = process.env.WALKTHROUGH_APP_URL ?? "https://studio.autocutengine.app";
export const SUPABASE_URL = "https://wbxwkuevmjawtcnbsbfg.supabase.co";
export const PROJECT_REF = "wbxwkuevmjawtcnbsbfg";
// Public anon key (ships to every browser by design; RLS protects data).
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndieHdrdWV2bWphd3RjbmJzYmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NjM5NzgsImV4cCI6MjEwNzIzOTk3OH0.IdOMaDmjebm7HJMhjH3BUhLEXvHNnm_wuh3-jnX02Z0";
export const VIEWPORT = { width: 1920, height: 1080 };
export const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;

export const DEMO = {
  orgId: "de000000-0000-4000-8000-000000000001",
  owner: "maya.owner@demo.autocutengine.app",
  admin: "leo.admin@demo.autocutengine.app",
  editor: "ana.editor@demo.autocutengine.app",
  editor2: "sam.editor@demo.autocutengine.app",
  platform: "platform.demo@demo.autocutengine.app",
  brands: {
    northbeam: "de000000-0000-4000-8000-0000000000b1",
    lumen: "de000000-0000-4000-8000-0000000000b2",
    peak: "de000000-0000-4000-8000-0000000000b3",
  },
};

/** Password grant against GoTrue, returning the raw session JSON. */
export async function passwordSession(email, password, anonKey = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** @supabase/ssr cookie format: "base64-" + base64url(JSON), chunked at 3180 chars. */
export function sessionCookies(session, domain) {
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = `sb-${PROJECT_REF}-auth-token`;
  const base = { domain, path: "/", httpOnly: false, secure: true, sameSite: "Lax" };
  const CHUNK = 3180;
  if (value.length <= CHUNK) return [{ ...base, name, value }];
  const out = [];
  for (let i = 0; i * CHUNK < value.length; i++) out.push({ ...base, name: `${name}.${i}`, value: value.slice(i * CHUNK, (i + 1) * CHUNK) });
  return out;
}

/** Injected into every page: cursor, ripple, captions, chapter cards. */
export const OVERLAY = `
(() => {
  if (window.__wt) return;
  const css = document.createElement('style');
  css.textContent = \`
    #wt-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
      transform:translate(-100px,-100px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}
    .wt-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;
      pointer-events:none;background:rgba(232,82,31,.35);animation:wtr .5s ease-out forwards}
    @keyframes wtr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #wt-caption{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;
      max-width:1300px;padding:16px 28px;border-radius:16px;background:rgba(22,23,26,.96);backdrop-filter:blur(6px);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);
      font:500 28px/1.35 Geist,system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .25s}
    #wt-caption.on{opacity:1}
    #wt-card{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:18px;background:#faf9f6;color:#16171a;font-family:Geist,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .35s}
    #wt-card.on{opacity:1}
    #wt-card .n{font:600 22px/1 Geist,system-ui;letter-spacing:.12em;text-transform:uppercase;color:#b94119}
    #wt-card .t{font:700 72px/1.05 Geist,system-ui;letter-spacing:-.03em}
    #wt-card .s{font:400 28px/1.4 Geist,system-ui;color:#686863;max-width:1100px;text-align:center}
    #wt-hl{position:fixed;z-index:2147483644;pointer-events:none;border:3px solid #e8521f;border-radius:14px;
      box-shadow:0 0 0 9999px rgba(22,23,26,.18);transition:all .35s;opacity:0}
    #wt-hl.on{opacity:1}
  \`;
  document.documentElement.appendChild(css);
  const cur = document.createElement('div');
  cur.id = 'wt-cursor';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l16 9-7.2 1.7L9 20z" fill="#16171a" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const cap = document.createElement('div'); cap.id = 'wt-caption';
  const card = document.createElement('div'); card.id = 'wt-card';
  const hl = document.createElement('div'); hl.id = 'wt-hl';
  const mount = () => { document.body.append(cur, cap, card, hl); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.__wt = {
    move(x, y) { cur.style.transform = 'translate(' + x + 'px,' + y + 'px)'; },
    ripple(x, y) { const r = document.createElement('div'); r.className = 'wt-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); },
    caption(text) { if (!text) { cap.classList.remove('on'); return; } cap.textContent = text; cap.classList.add('on'); },
    card(n, t, s) { if (!t) { card.classList.remove('on'); return; } card.innerHTML = '<div class="n">' + (n || '') + '</div><div class="t">' + t + '</div><div class="s">' + (s || '') + '</div>'; card.classList.add('on'); },
    highlight(r) { if (!r) { hl.classList.remove('on'); return; } Object.assign(hl.style, { left: (r.x - 8) + 'px', top: (r.y - 8) + 'px', width: (r.width + 16) + 'px', height: (r.height + 16) + 'px' }); hl.classList.add('on'); },
  };
})();
`;

/** A director wraps one Playwright page with tour-style helpers. */
export function director(page, t0 = Date.now()) {
  let pos = { x: 960, y: 540 };
  const sleep = (ms) => page.waitForTimeout(ms);
  const speedups = []; // [{start, end}] seconds from recording start, sped up by assemble.mjs

  async function ensureOverlay() {
    await page.evaluate(OVERLAY).catch(() => {});
    await page.evaluate(({ x, y }) => window.__wt?.move(x, y), pos).catch(() => {});
  }

  async function moveTo(target, { duration = 700 } = {}) {
    const box = await target.boundingBox();
    if (!box) throw new Error("moveTo: element not visible");
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const steps = Math.max(12, Math.round(duration / 16));
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
      await page.mouse.move(x, y);
      await page.evaluate(({ x, y }) => window.__wt?.move(x, y), { x, y });
      await sleep(16);
    }
    pos = to;
    return box;
  }

  return {
    page, sleep, ensureOverlay, speedups,
    /**
     * Waits for `ready` (a locator) while filming; the wait is marked so
     * the assembler plays it 8x faster. For waits the page blocks on
     * (server actions) that can't be skipped off camera.
     */
    async waitFilmed(ready, caption, timeout = 240_000) {
      await page.evaluate((t) => window.__wt?.caption(t), caption + "  (sped up)");
      const start = (Date.now() - t0) / 1000;
      await ready.first().waitFor({ state: "visible", timeout });
      speedups.push({ start, end: (Date.now() - t0) / 1000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await ensureOverlay();
      await page.evaluate(() => window.__wt?.caption(null));
      await sleep(600);
    },
    /** Like waitFilmed, but waits for `check()` (an async predicate) to return true. */
    async waitFilmedUntil(check, caption, timeout = 240_000) {
      await page.evaluate((t) => window.__wt?.caption(t), caption + "  (sped up)");
      const start = (Date.now() - t0) / 1000;
      const until = Date.now() + timeout;
      while (!(await check().catch(() => false))) {
        if (Date.now() > until) throw new Error(`timed out: ${caption}`);
        await sleep(2000);
      }
      speedups.push({ start, end: (Date.now() - t0) / 1000 });
      await ensureOverlay();
      await page.evaluate(() => window.__wt?.caption(null));
      await sleep(600);
    },
    async goto(path) { await page.goto(APP + path, { waitUntil: "networkidle" }); await ensureOverlay(); await sleep(500); },
    async caption(text, hold = 0) { await page.evaluate((t) => window.__wt?.caption(t), text); if (hold) await sleep(hold); },
    async card(n, title, sub, hold = 2600) {
      await page.evaluate(([n, t, s]) => window.__wt?.card(n, t, s), [n, title, sub]);
      await sleep(hold);
      await page.evaluate(() => window.__wt?.card(null, null));
      await sleep(400);
    },
    async point(locator, caption, hold = 1800) {
      const el = locator.first();
      // Pointing is decoration: a missing target shows the caption alone
      // instead of failing the whole chapter.
      if (!(await el.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) {
        console.error(`  ! point target not found: ${locator}`);
        if (caption) await page.evaluate((t) => window.__wt?.caption(t), caption);
        await sleep(hold);
        return;
      }
      await el.scrollIntoViewIfNeeded();
      const box = await moveTo(el);
      await page.evaluate((r) => window.__wt?.highlight(r), box);
      if (caption) await page.evaluate((t) => window.__wt?.caption(t), caption);
      await sleep(hold);
      await page.evaluate(() => window.__wt?.highlight(null));
    },
    async click(locator, caption, hold = 900) {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded();
      await moveTo(el);
      if (caption) await page.evaluate((t) => window.__wt?.caption(t), caption);
      await sleep(250);
      await page.evaluate(({ x, y }) => window.__wt?.ripple(x, y), pos);
      await el.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await ensureOverlay();
      await sleep(hold);
    },
    async type(locator, text, { delay = 45, caption } = {}) {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded();
      await moveTo(el);
      if (caption) await page.evaluate((t) => window.__wt?.caption(t), caption);
      await page.evaluate(({ x, y }) => window.__wt?.ripple(x, y), pos);
      await el.click();
      await el.pressSequentially(text, { delay });
      await sleep(400);
    },
    async scroll(dy, ms = 900) {
      const steps = Math.round(ms / 16);
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(16); }
      await sleep(300);
    },
  };
}
