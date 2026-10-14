// Functional checks: exercise every control and assert its consequence.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4500';
const browser = await chromium.launch({ executablePath: process.env.SCROLLCRAFT_CHROME });
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function run(viewport, label) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.addInitScript(() => {
    // Never take real pointer lock or capture in automation.
    Element.prototype.requestPointerLock = () => {};
    Element.prototype.setPointerCapture = () => {};
  });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => { if (!r.url().startsWith('mailto:')) failed.push(r.url()); });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(`${label}: no horizontal overflow`, overflow <= 0, `(${overflow}px)`);

  // Storyboard: split, merge, toggle.
  await page.locator('#storyboard').scrollIntoViewIfNeeded();
  const count = () => page.locator('#rows > li').count();
  ok(`${label}: starts with 6 scenes`, (await count()) === 6);
  await page.locator('#rows > li').nth(2).locator('.mini--split').click();
  ok(`${label}: split adds a scene`, (await count()) === 7);
  ok(`${label}: tiles follow split`, (await page.locator('#tiles > li').count()) === 7);
  ok(`${label}: board count follows`, (await page.textContent('#board-count')) === '7 scenes');
  await page.locator('#rows > li').nth(3).locator('.mini--merge').click();
  ok(`${label}: merge removes a scene`, (await count()) === 6);
  const pif = page.locator('#rows > li').nth(1).locator('.toggle-pif');
  await pif.click();
  ok(`${label}: product toggle flips`, (await pif.getAttribute('aria-pressed')) === 'true' || (await page.locator('#rows > li').nth(1).locator('.toggle-pif').getAttribute('aria-pressed')) === 'true');

  // Gate: export locked before approval.
  await page.locator('#approve').scrollIntoViewIfNeeded();
  ok(`${label}: download disabled before approval`, await page.locator('#btn-download').isDisabled());
  ok(`${label}: changes form hidden at rest`, !(await page.locator('#changes').isVisible()));

  // Request changes: empty note is rejected, a note sends you back.
  await page.click('#btn-changes');
  await page.locator('#changes button[type=submit]').click();
  ok(`${label}: empty change note rejected`, await page.locator('#changes-error').isVisible());
  await page.fill('#changes-note', 'Make scene 3 mention the discount');
  await page.locator('#changes button[type=submit]').click();
  await page.waitForTimeout(900);
  ok(`${label}: note shown on storyboard`, (await page.textContent('#board-note')).includes('discount'));
  ok(`${label}: gate says changes requested`, (await page.textContent('#gate-tag')) === 'Changes requested');

  // Approve unlocks export.
  await page.locator('#approve').scrollIntoViewIfNeeded();
  await page.click('#btn-approve');
  ok(`${label}: approval unlocks download`, !(await page.locator('#btn-download').isDisabled()));
  ok(`${label}: status bar shows approval`, (await page.textContent('#status-gate')).includes('approved'));
  ok(`${label}: approval carried to close`, (await page.textContent('#carry')).includes('6 scenes'));

  // Scope filter recomputes the manifest.
  await page.locator('#scope label', { hasText: 'Videos only' }).click();
  const vids = await page.locator('#files li').allTextContents();
  ok(`${label}: videos-only scope`, vids.length === 6 && vids.every(f => /^\d\d\.mp4$/.test(f)), vids.join(','));
  await page.locator('#scope label', { hasText: 'Everything' }).click();
  ok(`${label}: everything scope`, (await page.locator('#files li').count()) === 24);

  // Download contents.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
  const file = await dl.path();
  const text = fs.readFileSync(file, 'utf8');
  ok(`${label}: download filename`, dl.suggestedFilename() === 'northbeam-cold-brew-sample-export.txt');
  ok(`${label}: download has manifest, storyboard, SRT`, text.includes('01.mp4') && text.includes('Storyboard:') && text.includes('00:00:00,000 --> 00:00:05,000'));

  // Editing after approval re-locks the gate.
  await page.locator('#storyboard').scrollIntoViewIfNeeded();
  await page.locator('#rows > li').nth(0).locator('.toggle-pif').click();
  ok(`${label}: edit after approval re-locks`, await page.locator('#btn-download').isDisabled());
  ok(`${label}: gate asks to approve again`, (await page.textContent('#gate-tag')).includes('Approve again'));

  // Close form: validation, then a mailto with the details.
  await page.locator('#access').scrollIntoViewIfNeeded();
  await page.locator('#access-form button[type=submit]').click();
  ok(`${label}: empty form rejected`, await page.locator('#access-error').isVisible());
  await page.fill('#f-agency', 'Test Agency');
  await page.fill('#f-name', 'Sam Test');
  await page.fill('#f-email', 'not-an-email');
  await page.locator('#access-form button[type=submit]').click();
  ok(`${label}: bad email rejected`, (await page.textContent('#access-error')).toLowerCase().includes('work email'));
  await page.fill('#f-email', 'sam@test.example');
  const nav = page.waitForRequest(r => r.url().startsWith('mailto:'), { timeout: 3000 }).catch(() => null);
  await page.evaluate(() => {
    // Capture the mailto instead of leaving the page.
    window.__mailto = null;
    const desc = Object.getOwnPropertyDescriptor(window.location.__proto__, 'href');
  });
  await page.locator('#access-form button[type=submit]').click();
  await nav;
  ok(`${label}: success message is honest`, (await page.textContent('#access-status')).includes('Nothing is sent until you press send'));
  ok(`${label}: no-JS form uses POST, not GET`, (await page.getAttribute('#access-form', 'method')) === 'post');

  // Keyboard: the first tab stop is the skip link, and the stepper links work.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  ok(`${label}: first tab stop is skip link`, (await page.evaluate(() => document.activeElement.className)) === 'skip');
  await page.click('#stepper a[href="#approve"]');
  await page.waitForTimeout(1200);
  const top = await page.evaluate(() => document.getElementById('approve').getBoundingClientRect().top);
  ok(`${label}: stepper jumps to section`, top < viewport.height * 0.5, `(top ${Math.round(top)})`);

  ok(`${label}: no console errors`, errors.length === 0, errors.join(' | '));
  ok(`${label}: no failed requests`, failed.length === 0, failed.join(' | '));
  await ctx.close();
}

await run({ width: 1440, height: 900 }, 'desktop');
await run({ width: 390, height: 844 }, 'phone');
await run({ width: 360, height: 640 }, 'compact');
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter(r => r.startsWith('FAIL')).length} failed of ${results.length}`);
