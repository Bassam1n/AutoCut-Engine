// Records the AutoCut walkthrough, one clip per chapter, into out/raw.
//
//   DEMO_PASSWORD=... node record.mjs          # every chapter
//   DEMO_PASSWORD=... node record.mjs 05 06    # only these chapter numbers
//
// Chapters run in order and share state through the live app: chapter 05
// creates the demo ad, later chapters find it again by URL saved in
// out/state.json. A failing chapter saves a screenshot to out/errors and
// the run continues, so one broken selector never costs the whole take.

import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  chromium, director, passwordSession, sessionCookies,
  APP, VIEWPORT, CHROMIUM, DEMO,
} from "./lib.mjs";

const OUT = new URL("./out/", import.meta.url).pathname;
const RAW = OUT + "raw/";
const ERR = OUT + "errors/";
const STATE = OUT + "state.json";
mkdirSync(RAW, { recursive: true });
mkdirSync(ERR, { recursive: true });

const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) throw new Error("Set DEMO_PASSWORD (see README).");
const only = process.argv.slice(2);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

const ORG = `/org/${DEMO.orgId}`;
const DOMAIN = new URL(APP).hostname;
const browser = await chromium.launch({ executablePath: CHROMIUM });
// Fresh session per chapter: tokens last an hour and video waits are long.
async function cookiesFor(email) {
  return sessionCookies(await passwordSession(email, PASSWORD), DOMAIN);
}

/** Opens a context signed in as `email` (or anonymous when null). */
async function openAs(email, { record = true } = {}) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    ...(record ? { recordVideo: { dir: RAW, size: VIEWPORT } } : {}),
    acceptDownloads: true,
  });
  if (email) await ctx.addCookies(await cookiesFor(email));
  const t0 = Date.now();
  const page = await ctx.newPage();
  return { ctx, page, d: director(page, t0) };
}

/** Runs one chapter into out/raw/NN-slug.webm with a JSON sidecar. */
async function chapter(num, slug, title, as, body) {
  if (only.length && !only.includes(num)) return;
  console.log(`▶ ${num} ${title}`);
  const { ctx, page, d } = await openAs(as);
  try {
    await body(d, page);
  } catch (err) {
    console.error(`  ✖ ${num} failed at ${page.url()}: ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: `${ERR}${num}-${slug}.png` }).catch(() => {});
  }
  await d.caption(null).catch(() => {});
  const video = page.video();
  await ctx.close();
  if (video) {
    renameSync(await video.path(), `${RAW}${num}-${slug}.webm`);
    writeFileSync(`${RAW}${num}-${slug}.json`, JSON.stringify({ title, speedups: d.speedups }));
  }
}

/** Waits off camera (no recording) until `ready` shows on `path`, reloading as it goes. */
async function waitOffstage(as, path, readySelector, label, timeoutMs = 25 * 60_000) {
  console.log(`  … waiting off camera: ${label}`);
  const { ctx, page } = await openAs(as, { record: false });
  const until = Date.now() + timeoutMs;
  try {
    while (Date.now() < until) {
      await page.goto(APP + path, { waitUntil: "networkidle" });
      if (await page.locator(readySelector).first().isVisible().catch(() => false)) return true;
      await page.waitForTimeout(20_000);
    }
    console.error(`  ✖ timed out waiting for ${label}`);
    return false;
  } finally {
    await ctx.close();
  }
}

const nav = (p, label) => p.getByRole("link", { name: label, exact: true });
const btn = (p, label, exact = false) => p.getByRole("button", { name: label, exact });

// ───────────────────────────────────────────────────────────── chapters

await chapter("00", "intro", "Welcome", null, async (d, p) => {
  await p.goto(APP + "/login", { waitUntil: "networkidle" });
  await d.ensureOverlay();
  await d.card("AutoCut Engine", "Product walkthrough", "Every screen, every option — from a brief to a finished, approved video ad.", 4200);
  await d.card("Chapters", "What you'll see", "Sign in · Setup & keys · Brands · The Studio, step by step · Board & reviews · Roles · Settings · Platform admin", 4200);
});

await chapter("01", "sign-in", "Signing in", null, async (d, p) => {
  await d.card("01", "Signing in", "No passwords. Everyone signs in with a one-time link.");
  await d.goto("/login");
  await d.point(p.locator("form"), "Team members sign in with their work email. There are no passwords to forget or leak.", 2600);
  await d.type(p.locator('input[type="email"]'), "maya.owner@northbeam.studio", { caption: "Type your email…" });
  await d.point(btn(p, "Send sign-in link"), "…and AutoCut emails a one-time sign-in link. It works once, then expires.", 2600);
  await d.caption("Only invited people can get in. Unknown emails see the same screen, but nothing is ever sent.", 3400);
});

await chapter("02", "home", "Your workspace", DEMO.owner, async (d, p) => {
  await d.card("02", "Your workspace", "Signed in as Maya, the agency owner.");
  await d.goto(`${ORG}/board`);
  await d.point(p.locator("aside").first(), "The sidebar holds everything: work, brands, the asset library, and settings.", 2800);
  await d.point(btn(p, /create ad/i), "Start a new ad from anywhere with Create ad.", 2200);
  await d.point(p.getByRole("button", { name: /notifications/i }), "The bell collects review requests, approvals and requested changes.", 2400);
  await d.point(p.locator("select").first(), "Switch between brands, or view all of them at once.", 2400);
  await d.point(p.getByRole("button", { name: /refresh/i }).first(), "Refresh pulls in your teammates' latest changes.", 2000);
  await d.goto(`${ORG}/brands`);
  await d.point(p.locator("main"), "Brands: one workspace per client, each with its own products, customers, cast and keys.", 3000);
});

await chapter("03", "keys", "Connect your AI providers", DEMO.owner, async (d, p) => {
  await d.card("03", "Connect your AI providers", "Your agency brings its own keys and pays providers directly.");
  await d.goto(`${ORG}/settings/keys`);
  await d.caption("Org-wide keys: one key per provider, used by every brand unless a brand has its own.", 3000);
  const providers = [
    ["Anthropic", process.env.DEMO_ANTHROPIC_KEY, "Anthropic writes the scripts, plans and storyboards."],
    ["kie.ai", process.env.DEMO_KIE_KEY, "kie.ai generates scene images and videos."],
    ["fal.ai", process.env.DEMO_FAL_KEY, "fal.ai is another image and video provider."],
    ["ElevenLabs", process.env.DEMO_ELEVENLABS_KEY, "ElevenLabs records the voiceover."],
  ];
  for (const [label, key, why] of providers) {
    if (!key) continue;
    const field = p.getByPlaceholder(`Paste your ${label} API key`);
    if (!(await field.isVisible().catch(() => false))) {
      await d.point(p.getByText(label, { exact: true }), `${why} Already connected and verified.`, 2200);
      continue;
    }
    await d.type(field, key, { delay: 4, caption: `${why} The key is masked as you paste it.` });
    await d.click(field.locator("xpath=following::button[normalize-space()='Verify & save'][1]"), "Verify & save tests the key with the provider before storing it, encrypted.", 2400);
  }
  await d.point(p.getByText("Slack notifications"), "Connect Slack and review requests and approvals post to your channel.", 2800);
});

await chapter("04", "brands", "Brands, products & customers", DEMO.owner, async (d, p) => {
  await d.card("04", "Brands, products & customers", "Everything the AI needs to write on-brand ads.");
  await d.goto(`${ORG}/brands`);
  await d.click(p.getByText("Northbeam Cold Brew").first(), "Open a brand to see its products.", 1400);
  await d.goto(`${ORG}/brands/${DEMO.brands.northbeam}/edit`);
  await d.point(p.locator("form").first(), "Brand context — tone, audience and product facts — feeds every script and storyboard.", 3200);
  await d.point(p.getByText("Assigned users"), "Assign team members to brands. Users only ever see the brands they're assigned.", 3000);
  await d.goto(`${ORG}/brands/${DEMO.brands.northbeam}/customers`);
  await d.caption("Customer profiles describe who the ads are for. The Studio can save new ones as you work.", 3000);
  await d.goto(`${ORG}/brands/${DEMO.brands.northbeam}/cast`);
  await d.caption("The brand cast: recurring characters you can reuse across ads for a consistent look.", 3000);
  await d.goto(`${ORG}/brands/${DEMO.brands.northbeam}/products`);
  await d.caption("Products carry what they are and their real-world size, so they render at the right scale.", 3000);
  await d.goto(`${ORG}/brands/${DEMO.brands.northbeam}/settings/keys`);
  await d.caption("A brand can have its own keys, e.g. when a client pays for their own generation.", 3000);
});

await chapter("05", "studio-scripts", "Studio · Scripts", DEMO.owner, async (d, p) => {
  await d.card("05", "The Studio", "One ad, nine steps. A person approves every one.");
  await d.goto(`${ORG}/brands`);
  await d.click(btn(p, /create ad/i), "Create ad: pick a brand…", 1000);
  await d.click(btn(p, "Northbeam Cold Brew", true), null, 900);
  await d.click(btn(p, "Original Cold Brew 250ml", true), "…then the product.", 1400);
  // Style preview images 404 in production; show plain tiles rather than broken-image icons.
  await p.evaluate(() => document.querySelectorAll("main img").forEach((i) => { if (!i.naturalWidth) i.style.visibility = "hidden"; }));
  await d.point(p.getByRole("heading", { name: "Pick a style to start" }), "Pick a visual style. It sets the look of every image and video.", 2400);
  await d.click(btn(p, /Lifestyle B-Roll/), null, 800);
  await d.click(btn(p, "Start this ad"), "Start this ad opens the Studio.", 2000);
  await p.waitForURL(/\/ads\/[0-9a-f-]{36}/, { timeout: 60_000 });
  state.adUrl = new URL(p.url()).pathname; save();
  await d.point(p.getByText("Scripts", { exact: true }).first(), "The stepper tracks the nine steps. Finished steps get a check mark.", 2600);
  await d.point(p.getByText("Cost so far"), "Cost so far adds up what every generation on this ad has cost.", 2600);
  await d.point(p.locator("#length"), "Set the ad length…", 1800);
  await d.click(btn(p, /Generate 3 scripts/), "…and generate three script variations from the brand and product.", 400);
  await d.waitFilmed(btn(p, "Use this script"), "Writing three scripts");
  await d.point(p.getByText("Variant 1"), "Three variations, each with a different hook and angle.", 2600);
  await d.click(btn(p, "Use this script").nth(1), "Pick the one that fits best.", 1800);
});

await chapter("06", "studio-brief-plan", "Studio · Fine-tune & scene plan", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  // Choosing a script can land straight on the scene plan; step back to film fine-tune.
  if (!(await btn(p, "Start", true).isVisible().catch(() => false))) await d.click(btn(p, /Previous step/), null, 1200);
  await d.point(btn(p, "Start", true), "Fine-tune asks a few quick questions about the viewer and the ad. Answers can be saved as a customer profile.", 3200);
  await d.click(btn(p, /Skip for now/), "We'll skip it for this demo.", 1500);
  await d.click(btn(p, /Generate scene plan/), "The scene plan splits the script into scenes.", 400);
  await d.waitFilmed(p.getByText("Scene 1", { exact: true }), "Planning scenes");
  await d.point(p.getByText(/Scene 1/).first(), "Every scene is editable: rewrite copy, split, duplicate or merge scenes.", 3000);
  await d.point(btn(p, /Pin idea note/).first(), "Pin notes to steer a scene — an idea, or a rule it must follow.", 2600);
  await d.click(btn(p, /Lock the plan/), "Lock the plan when it reads right.", 1500);
  await d.click(btn(p, /Continue/), null, 1200);
});

await chapter("07", "studio-concept", "Studio · Concept & cast", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  if (await btn(p, /Continue/).isVisible().catch(() => false)) await d.click(btn(p, /Continue/), null, 1200);
  await d.click(btn(p, /Generate concepts/), "Concepts are creative directions for the whole ad.", 400);
  await d.waitFilmed(btn(p, "Use this concept"), "Generating concepts");
  await d.point(btn(p, "Refine").first(), "Refine a concept, or write your own.", 2200);
  await d.click(btn(p, "Use this concept").first(), "Use this concept.", 1500);
  await d.click(btn(p, /Extract cast/), "Extract cast finds every character the concept needs.", 400);
  await d.waitFilmed(btn(p, /Approve all/), "Extracting the cast");
  await d.point(p.getByText("Model", { exact: true }).first(), "Pick the image model. Models without a saved key are flagged.", 2600);
  await d.point(btn(p, /Character sheet/).first(), "Generate reference images and character sheets so people look the same in every scene.", 3000);
  await d.click(btn(p, /Approve all/), "Approve the cast…", 1200);
  await d.click(btn(p, /Generate storyboard/), "…and generate the storyboard.", 400);
  await d.waitFilmed(p.getByRole("heading", { name: "Storyboard" }), "Building the storyboard");
});

await chapter("08", "studio-storyboard", "Studio · Storyboard", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  await d.point(p.getByPlaceholder(/make scene 3/), "Edit by chat: describe a change in plain words and the storyboard patches itself.", 2800);
  await d.type(p.getByPlaceholder(/make scene 3/), "Make the last scene end on the can with a clear call to action", { delay: 25 });
  await d.click(btn(p, "Patch", true), null, 400);
  await d.waitFilmed(btn(p, "Patch", true), "Patching the storyboard");
  await d.point(p.getByText(/Product (in|not in) frame/).first(), "Toggle whether the product appears in each scene.", 2400);
  await d.point(btn(p, /Rewrite/).first(), "Or rewrite a single scene with a one-line instruction.", 2400);
  await d.click(btn(p, /Continue to scene images/), "On to scene images.", 1500);
});

await chapter("09", "studio-images", "Studio · Scene images", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  await d.point(p.getByText("Images per scene"), "Choose how many options to generate per scene.", 2200);
  await d.point(btn(p, "Browse library"), "Or reuse saved images from the library.", 2000);
  await d.click(btn(p, "Generate All", true), "Generate All runs every scene at once on your own keys.", 400);
  await d.waitFilmed(p.locator("img:not(aside img)").nth(2), "Generating scene images", 6 * 60_000);
  await d.sleep(4000);
  await d.goto(state.adUrl);
  await d.point(p.locator("img:not(aside img)").first(), "Every scene gets its own options. Keep the best ones.", 2600);
  await d.point(btn(p, /Give feedback/).first(), "Give feedback to tweak or rework an image — the AI can remember the correction for next time.", 3200);
  await d.point(btn(p, /Edit prompt/).first(), "Power users can see and override the exact prompt.", 2400);
  await d.click(btn(p, /Continue to scene videos/), "Next: voiceover.", 1500);
});

await chapter("10", "studio-voiceover", "Studio · Voiceover", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  await d.point(p.getByPlaceholder(/Search voices/), "Browse the ElevenLabs voice library: search and filter by gender, age and library.", 3000);
  await d.click(btn(p, /Suggest voice/).first(), "Or let AutoCut suggest a voice and delivery that fit the scene.", 400);
  await d.waitFilmed(p.getByText(/Thinking/).first(), "Choosing a voice", 15_000).catch(() => {});
  await p.getByText(/Thinking/).first().waitFor({ state: "hidden", timeout: 120_000 }).catch(() => {});
  // Generate All starts scenes a second apart from this page, so keep it open until every job is queued.
  await d.click(btn(p, "Generate All", true), "Generate the voiceover for every scene, with captions.", 10_000);
});

if (!only.length || only.includes("11")) {
  if (state.adUrl) await waitOffstage(DEMO.owner, state.adUrl, "audio", "voiceover");
}

await chapter("11", "studio-videos", "Studio · Scene videos", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  await d.caption("A few minutes later: every scene has its voiceover, with a captions file.", 2800);
  await d.point(p.locator("audio").first(), "Play it back right here.", 2200);
  await d.click(btn(p, /Continue to Scene videos/), null, 1500);
  await d.point(p.getByText("Who speaks on camera?"), "Choose who speaks on camera, so lip-sync only runs where it should.", 2800);
  await d.point(p.getByText("Duration").first(), "Set each scene's length, and pick which image to animate.", 2600);
  await d.click(btn(p, "Generate All", true), "Generate All turns every scene image into video.", 10_000);
});

if (!only.length || only.includes("12")) {
  if (state.adUrl) await waitOffstage(DEMO.owner, state.adUrl, "video", "scene videos");
}

await chapter("12", "studio-export", "Studio · Export", DEMO.owner, async (d, p) => {
  await d.goto(state.adUrl);
  await d.caption("Video models take a while — here's the result.", 2600);
  await d.point(p.locator("video").first(), "Every scene, animated from its approved image.", 3000);
  await d.click(btn(p, /Continue to Export/), null, 1500);
  await d.point(p.locator("select").first(), "Export everything, or just images, videos, or voiceover with captions.", 2800);
  await d.point(btn(p, "Download zip"), "One zip, files named by scene.", 2600);
});

await chapter("13", "board", "The board", DEMO.owner, async (d, p) => {
  await d.card("13", "The board", "Every ad across every brand, from To do to Delivered.");
  await d.goto(`${ORG}/board`);
  await d.point(p.locator("main"), "Owners and admins see the whole pipeline. Columns are fully customisable.", 3000);
  await d.point(p.getByLabel("Filter by assignee"), "Filter by assignee or brand.", 2200);
  await d.click(btn(p, "New task", true), "Create a task, assign it, set a due date, and link the ad.", 1200);
  await d.type(p.getByLabel("Title"), "Northbeam morning spot — final cut", { delay: 30 });
  await d.point(p.getByLabel("Ad"), "Linking the ad lets reviewers jump straight to it.", 2200);
  await d.click(btn(p, /Create task/), null, 1500);
  await d.point(btn(p, /options/).first(), "Rename, reorder or remove columns from each column's menu.", 2400);
  await d.point(btn(p, /Add column/), "Add your own columns too.", 2000);
  // Move the linked task to In review with the edit modal's Column select.
  await d.click(p.getByRole("button", { name: /Northbeam morning spot/ }), "Moving a task to In review starts a review round.", 1200);
  await p.getByLabel("Column").selectOption({ label: "In review" }).catch(() => {});
  await d.click(btn(p, "Save", true), "Drag cards between columns, or change the column here.", 2200);
});

await chapter("14", "review", "Reviews & revisions", DEMO.owner, async (d, p) => {
  await d.card("14", "Reviews & revisions", "Scene-by-scene feedback, attached to the exact shot.");
  await d.goto(`${ORG}/board`);
  await d.click(btn(p, /notifications/i), "Reviewers get notified in the app — and in Slack, if connected.", 1500);
  await d.click(p.getByText(/review/i).first(), null, 1500);
  await d.point(p.getByRole("radiogroup").first(), "Approve each scene, or request changes.", 2400);
  await d.click(p.getByRole("radio", { name: "Request changes" }).nth(1), null, 800);
  await d.type(p.getByPlaceholder(/Make the bottle bigger/), "Show the can label clearly in the last shot.", { delay: 30, caption: "Say exactly what should change." });
  await d.click(btn(p, /Request changes \(/), "Submitting sends the task to Revisions and notifies the editor.", 2500);
});

await chapter("15", "editor-view", "What a team member sees", DEMO.editor, async (d, p) => {
  await d.card("15", "What a team member sees", "Ana is a User, assigned to two brands.");
  await d.goto(`${ORG}/tasks`);
  await d.point(p.locator("aside").first(), "Users get My tasks instead of the full board, and no team or billing settings.", 3000);
  await d.point(p.locator("main"), "Only their own tasks, across their assigned brands.", 2600);
  await d.goto(`${ORG}/brands`);
  await d.caption("Brands they aren't assigned to simply don't exist for them.", 2800);
  await d.goto(`${ORG}/profile`);
  await d.point(p.locator("main form").first(), "Everyone manages their own profile: name, phone and photo.", 2800);
});

await chapter("16", "team", "Your team & permissions", DEMO.owner, async (d, p) => {
  await d.card("16", "Your team & permissions", "Owners invite, assign roles and control access.");
  await d.goto(`${ORG}/team`);
  await d.point(p.getByText(/seats used/), "Seats are capped by your plan.", 2200);
  await d.point(p.getByLabel(/Role for/).first(), "Roles: Owner, Admin, User. Admins manage the board; Users do the work.", 3000);
  await d.point(p.getByText("Can add products & edit brands").first(), "Let specific Users add products and edit brands.", 2600);
  await d.point(btn(p, /Deactivate/).first(), "Deactivate a seat without deleting anyone's work.", 2400);
  await d.type(p.getByPlaceholder("teammate@agency.com"), "new.editor@northbeam.studio", { caption: "Invite by email — they get a sign-in link, or share one over WhatsApp." });
  await d.caption(null);
});

await chapter("17", "admin-view", "What an admin sees", DEMO.admin, async (d, p) => {
  await d.card("17", "What an admin sees", "Leo runs production but doesn't manage the team.");
  await d.goto(`${ORG}/team`);
  await d.caption("Admins see the team read-only.", 2400);
  await d.goto(`${ORG}/settings/spend`);
  await d.point(p.locator("main"), "Spend & guard: a daily warning and a hard stop. Generation pauses itself before bills surprise you.", 3400);
});

await chapter("18", "settings", "Rules, styles, library & history", DEMO.owner, async (d, p) => {
  await d.card("18", "Rules, styles, library & history", "The tools that keep every ad on-brand.");
  await d.goto(`${ORG}/settings/rules`);
  await d.caption("Rules: standing instructions every generation follows — pause or edit any time.", 3000);
  await d.goto(`${ORG}/styles`);
  await d.caption("Visual styles: curated looks with a masterprompt behind each one.", 3000);
  await d.goto(`${ORG}/library`);
  await d.caption("The library: every saved image and video, tagged by brand, character and style.", 3000);
  await d.goto(`${ORG}/creative-history`);
  await d.caption("Creative history: every ad across your agency, one click from the Studio.", 3000);
  await d.goto(`${ORG}/products`);
  await d.caption("All products across every brand in one place.", 2600);
});

await chapter("19", "platform", "Platform admin", DEMO.platform, async (d, p) => {
  await d.card("19", "Platform admin", "For the AutoCut team: every agency, one dashboard.");
  await d.goto("/platform-admin");
  await d.caption("Totals, daily spend, agencies that need attention, and recent activity.", 3200);
  await d.click(nav(p, "Agencies"), "Every agency, with status, plan, seats and spend.", 2600);
  await d.click(p.getByText("Northbeam Studio (demo)").first(), "Open an agency…", 1600);
  for (const tab of ["Members", "Brands", "Usage", "Activity", "Settings"]) {
    await d.click(nav(p, tab), {
      Members: "Members: invite with a copyable link, change roles and emails, toggle seats and ad access.",
      Brands: "Brands and their products, ads and assignees.",
      Usage: "90 days of spend by provider and generation type.",
      Activity: "A full audit log of everything that changed.",
      Settings: "Plan, internal notes, seat cap, spend limits — and suspend or reactivate.",
    }[tab], 2600);
  }
  await d.click(nav(p, "Access requests"), "Access requests from the website land here.", 2600);
  await d.click(nav(p, "Platform admins"), "And manage who can see all of this.", 2400);
});

await chapter("20", "outro", "That's AutoCut", null, async (d, p) => {
  await p.goto(APP + "/login", { waitUntil: "networkidle" });
  await d.ensureOverlay();
  await d.card("AutoCut Engine", "Brief in. Finished ad out.", "autocutengine.app", 4500);
});

await browser.close();
console.log("Done. Now run: node assemble.mjs");
