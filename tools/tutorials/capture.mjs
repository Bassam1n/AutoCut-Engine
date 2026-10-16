// Captures the interactive tutorials from the live demo agency.
//
// Each tutorial is a list of steps. For every step the script brings
// the app into the right state, takes a screenshot, and records where
// the step's target (the thing to click or look at) sits on screen.
// The app's Tutorials player then shows the screenshot with a hotspot
// on that target. Nothing is ever submitted: steps only navigate, open
// menus and modals, and close them again.
//
//   DEMO_PASSWORD=... node capture.mjs            # all tutorials
//   DEMO_PASSWORD=... node capture.mjs ad-pipeline # just some
//
// Output: apps/web/public/tutorials/<id>/<n>.jpg and
// apps/web/src/lib/tutorials/tutorials.json. Re-run whenever the UI
// changes enough that the screenshots look out of date.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROMIUM, APP, DEMO, SUPABASE_URL, ANON_KEY, passwordSession, sessionCookies } from "../walkthrough/lib.mjs";
import { TUTORIALS, DEMO_AD_ID } from "./tutorials.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = join(ROOT, "apps/web/public/tutorials");
const DATA_FILE = join(ROOT, "apps/web/src/lib/tutorials/tutorials.json");
const VIEWPORT = { width: 1440, height: 900 };

const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) throw new Error("Set DEMO_PASSWORD (see tools/walkthrough/README.md).");

const only = process.argv.slice(2);
const existing = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : { tutorials: [] };
const output = new Map(existing.tutorials.map((t) => [t.id, t]));

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
});
const sessions = new Map();

async function pageFor(role) {
  const email = DEMO[role];
  if (!sessions.has(email)) sessions.set(email, await passwordSession(email, PASSWORD));
  const ctx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light", deviceScaleFactor: 1 });
  await ctx.addCookies(sessionCookies(sessions.get(email), new URL(APP).hostname));
  return ctx.newPage();
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

// The ad studio only lets you click back to earlier steps, and every
// step change is saved on the ad, so ad tutorials park the demo ad on
// Export before each shot and jump back to the step they show.
const helpers = {
  async setAdStep(step) {
    const owner = sessions.get(DEMO.owner) ?? (await passwordSession(DEMO.owner, PASSWORD));
    sessions.set(DEMO.owner, owner);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ads?id=eq.${DEMO_AD_ID}`, {
      method: "PATCH",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${owner.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ current_step: step }),
    });
    if (!res.ok) throw new Error(`setAdStep failed: ${res.status} ${await res.text()}`);
  },
  app: APP,
  demo: DEMO,
};

let failures = 0;

for (const tutorial of TUTORIALS) {
  if (only.length && !only.includes(tutorial.id)) continue;
  const page = await pageFor(tutorial.as ?? "owner");
  const dir = join(PUBLIC_DIR, tutorial.id);
  mkdirSync(dir, { recursive: true });
  const steps = [];

  for (let i = 0; i < tutorial.steps.length; i++) {
    const step = tutorial.steps[i];
    try {
      if (step.go) {
        await page.goto(APP + step.go(DEMO), { waitUntil: "domcontentloaded" });
      }
      await settle(page);
      if (step.before) {
        await step.before(page, helpers);
        await settle(page);
      }

      let box = null;
      const target = step.target ? step.target(page).first() : null;
      if (target) {
        await target.waitFor({ state: "visible", timeout: 8000 });
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        const b = await target.boundingBox();
        if (b) {
          box = {
            x: +(b.x / VIEWPORT.width).toFixed(4),
            y: +(b.y / VIEWPORT.height).toFixed(4),
            w: +(b.width / VIEWPORT.width).toFixed(4),
            h: +(b.height / VIEWPORT.height).toFixed(4),
          };
        }
      }

      const file = `${String(i + 1).padStart(2, "0")}.jpg`;
      await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 78 });
      steps.push({ image: `/tutorials/${tutorial.id}/${file}`, box, title: step.title, body: step.body, click: Boolean(step.click) });
      console.log(`${tutorial.id} ${i + 1}/${tutorial.steps.length} ok${box ? "" : " (no target)"}`);

      // A "click" step advances by clicking its target, like the viewer will.
      if (step.click && target) {
        await target.click();
        await settle(page);
      }
      if (step.after) {
        await step.after(page, helpers);
        await settle(page);
      }
    } catch (err) {
      failures++;
      console.log(`${tutorial.id} ${i + 1}/${tutorial.steps.length} FAILED: ${err.message.split("\n")[0]}`);
    }
  }

  output.set(tutorial.id, {
    id: tutorial.id,
    title: tutorial.title,
    description: tutorial.description,
    category: tutorial.category,
    roles: tutorial.roles,
    minutes: Math.max(1, Math.round(steps.length / 4)),
    appPath: tutorial.appPath ?? null,
    steps,
  });
  await page.context().close();
}

await helpers.setAdStep("export");
await browser.close();

const ordered = TUTORIALS.map((t) => output.get(t.id)).filter(Boolean);
mkdirSync(dirname(DATA_FILE), { recursive: true });
writeFileSync(DATA_FILE, JSON.stringify({ capturedAt: new Date().toISOString().slice(0, 10), tutorials: ordered }, null, 2) + "\n");
console.log(failures ? `done with ${failures} failed steps` : "done");
