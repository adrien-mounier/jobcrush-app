// #192 the phone profile re-composed: the rail leads, the facts open as a bottom pull-up sheet.
//
// Driven as a human on two phone viewports and then on desktop, human-paced. The API is
// route-mocked (the pinned ProfileState shape profile.spec.ts uses), so this needs only a built web
// app — no Fastify, no model key:
//
//   cd apps/web && npx next build && npx next start -p 3100
//   BASE_URL=http://127.0.0.1:3100 node apps/web/e2e/profile-phone-sheet-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those.
//
// Beyond the ACs it drives the edges the .spec.ts does not reach: a real multi-step pull gesture,
// the full three-layer Escape stack (detail -> selection -> sheet), Escape pressed inside a
// correction question that lives INSIDE the sheet, focus rescue on collapse, the desktop
// behaviour-identity check (including the ACTIVE toggle and a bare Escape), and reduced motion.

import fs from 'node:fs';
import path from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const OWNER = process.env.QA_OWNER_SHOTS ?? 'qa-results/owner-shots';
fs.mkdirSync(OWNER, { recursive: true });

const qa = await createSession('profile-phone-sheet', { baseURL: BASE, viewport: { width: 390, height: 844 } });
const { page } = qa;
page.setDefaultTimeout(12000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch { /* closed */ }
    process.exit(1);
  });
}

const BASE_PROFILE = {
  factCount: 4,
  search: { role: 'IT project manager in Paris', family: null, siblingTitles: [], openJobs: null },
  contact: { phone: { value: '+852 1234 5678', origin: 'read' }, email: { value: 'mei@example.com', origin: 'person-said' } },
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [
        { id: 'e1', text: 'Managed a team of six engineers.', colour: 'gold', source: 'told' },
        { id: 'e2', text: 'Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.', colour: 'grey', source: 'read' },
        { id: 'e3', text: 'Led SAP cutover planning.', colour: 'grey', source: 'told' },
      ],
    },
    { tag: 'skill', heading: 'Skills', facts: [{ id: 's1', text: 'SQL.', colour: 'gold', source: 'told' }] },
  ],
};

let state = structuredClone(BASE_PROFILE);
await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: state }));
await page.route('**/api/sessions/me/targets', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/contact', (r) => r.fulfill({ json: { ok: true } }));

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const shot = async (name) => { await page.screenshot({ path: path.join(OWNER, name) }); await qa.note(`owner screenshot filed: ${name}`); };
const expanded = () => page.locator('.pfgrab').getAttribute('aria-expanded');
const live = () => page.locator('.sr-only[aria-live]').first().textContent();
const activeIs = (sel) => page.evaluate((s) => document.activeElement?.matches(s) ?? false, sel);
// Escape pressed the way a person presses it: on the keyboard, without moving focus first (a
// locator.press('body') would silently reassign focus and fake the focus-rescue result).
const escape = async (note) => { await page.keyboard.press('Escape'); await page.waitForTimeout(700); await qa.note(note); };

// A real pull, not a click: press on the grabber and drag it upward in steps, at human speed.
async function pull(dy, note) {
  await qa.note(note);
  const b = await page.locator('.pfgrab').boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y + (dy * i) / 10);
    await page.waitForTimeout(45);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(700);
}

// ==============================================================================================
// 1. Phone 390x844 — the rail leads.
// ==============================================================================================

await qa.goto('/profile', 'open the profile on a 390x844 phone');
await qa.expectVisible('.pcount', 'the hero is the first thing on the screen');
await qa.expectVisible('.rpanel', 'the Job family panel leads, right under the hero');
await qa.expectVisible('.rail .rdoor', 'the "Not the job you meant?" door is there without opening anything');
await shot('phone-rail-first.png');

await qa.expectVisible('.pfgrab', 'the facts sheet sits collapsed at the bottom with its grabber');
await qa.expectText('.pftitle', 'Your facts', 'the collapsed edge says what is inside');
await qa.expectText('.pfnum', '4', 'the collapsed edge carries the fact count, so the pull is obvious');
await qa.expectText('.pfhint', 'Pull up to open', 'the edge invites the pull');
await assert((await expanded()) === 'false', 'the sheet reports itself collapsed');
const hidden = await page.locator('#profileview').isVisible();
await assert(!hidden, 'collapsed: the facts are out of the tab order and the reading order');
await shot('phone-sheet-collapsed.png');

const clearance = await page.evaluate(() => {
  const d = document.querySelector('.rail .rdoor').getBoundingClientRect();
  const h = document.querySelector('.pfsheet-head').getBoundingClientRect();
  return { doorBottom: Math.round(d.bottom), peekTop: Math.round(h.top), scroll: document.querySelector('.stage').scrollTop };
});
await assert(clearance.doorBottom <= clearance.peekTop && clearance.scroll === 0,
  `the door ends at ${clearance.doorBottom}px, clear of the sheet edge at ${clearance.peekTop}px, with no scrolling`);

await qa.scrollThrough('read the new first screen top to bottom');

// ==============================================================================================
// 2. The pull, the browse, and the three-layer Escape.
// ==============================================================================================

await pull(-110, 'pull the sheet up by dragging the grabber, the way a thumb would');
await assert((await expanded()) === 'true', 'a real pull past the threshold opens the sheet');
await qa.expectVisible('#profileview', 'the facts are now on screen');
await assert(/Your facts opened\./.test(await live()), 'the opening is announced');
await shot('phone-sheet-expanded-sorted.png');

await qa.expectVisible('.sheetwrap', 'the Sorted list fills the sheet');
await page.locator('.pfsheet-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(900);
await qa.expectVisible('.dnote', 'the sheet scrolls to the end of the list — nothing is cut off');
await page.locator('.pfsheet-body').evaluate((el) => { el.scrollTop = 0; });
await page.waitForTimeout(600);

await qa.click('.frow', 'open a saved fact from inside the sheet');
await qa.expectVisible('dialog.detail', 'the detail dialog opens above the sheet');
await escape('press Escape once');
await assert(!(await page.locator('dialog.detail').isVisible()), 'Escape closes the detail first');
await assert((await expanded()) === 'true', 'and leaves the sheet open behind it — the layers unwind one at a time');

await escape('press Escape again with nothing else open');
await assert((await expanded()) === 'false', 'the second Escape collapses the sheet');
await assert(await activeIs('.pfgrab'), 'focus lands on the grabber, never stranded on the body');
await assert(/Your facts closed\./.test(await live()), 'the collapse is announced');
await qa.expectVisible('.rail .rdoor', 'collapsing returns to the rail view');

// ==============================================================================================
// 3. Keyboard route, the toggle, and the constellation inside the sheet.
// ==============================================================================================

await page.locator('.pfgrab').focus();
await qa.press('.pfgrab', 'Enter', 'keyboard route: open the sheet with Enter on the grabber');
await assert((await expanded()) === 'true', 'the grabber works as a keyboard disclosure');
await assert(await activeIs('.pfgrab'), 'focus stays on the grabber — no jump into the content');

await qa.click('button[aria-label="Constellation"]', 'switch to the Constellation view inside the sheet');
await page.waitForTimeout(900);
await qa.expectVisible('.sky', 'the constellation fills the sheet');
await assert((await expanded()) === 'true', 'switching views does not close the sheet');
await shot('phone-sheet-expanded-constellation.png');

const skyFills = await page.evaluate(() => {
  const s = document.querySelector('.sky').getBoundingClientRect();
  const b = document.querySelector('.pfsheet-body').getBoundingClientRect();
  return Math.abs(s.height - b.height) < 4;
});
await assert(skyFills, 'the constellation takes the whole sheet instead of its old fixed box');

await qa.click('.skylist .star', 'tap a star to select a fact');
await qa.expectVisible('.sheet.in', 'the constellation detail card appears');
await escape('Escape with a star selected');
await assert(!(await page.locator('.sheet.in').count()), 'Escape clears the selection first');
await assert((await expanded()) === 'true', 'the sheet is still open — layer two, not layer three');
await escape('Escape once more');
await assert((await expanded()) === 'false', 'the last Escape collapses the sheet');

await qa.click('button[aria-label="Sorted"]', 'tap the Sorted toggle while the sheet is collapsed');
await assert((await expanded()) === 'true', 'a toggle tap opens the sheet and switches the view together');

// ==============================================================================================
// 4. A correction door reached through the sheet (#190 contact) — including its Escape.
// ==============================================================================================

await qa.click('.cxfield .rdoor', 'open the phone-number door from inside the sheet');
await qa.expectVisible('#contact-phone-again', 'the contact question opens inside the sheet');
const pre = await page.locator('#contact-phone-again').inputValue();
await assert(pre === '+852 1234 5678', 'the question is pre-filled with the number on the CV');
await assert(await activeIs('#contact-phone-again'), 'focus lands in the field');

await qa.press('#contact-phone-again', 'Escape', 'press Escape to back out of the correction');
const doorBack = await page.locator('.cxfield .rdoor').first().isVisible();
const sheetAfter = await expanded();
await assert(doorBack, 'backing out returns the contact row to its display state');
await assert(sheetAfter === 'true', 'ADVERSARIAL: Escape inside a question must not also slam the whole sheet shut');

// ==============================================================================================
// 5. The narrow phone, 360x800.
// ==============================================================================================

await page.setViewportSize({ width: 360, height: 800 });
await qa.goto('/profile', 'open the profile on a narrow 360x800 phone');
await qa.expectVisible('.rail .rdoor', 'the correction door is on the first screen at 360px too');
const narrow = await page.evaluate(() => {
  const d = document.querySelector('.rail .rdoor').getBoundingClientRect();
  const h = document.querySelector('.pfsheet-head').getBoundingClientRect();
  const g = document.querySelector('.pfgrab').getBoundingClientRect();
  return { doorBottom: Math.round(d.bottom), peekTop: Math.round(h.top), grabH: Math.round(g.height), scroll: document.querySelector('.stage').scrollTop };
});
await assert(narrow.doorBottom <= narrow.peekTop && narrow.scroll === 0,
  `360px: the door ends at ${narrow.doorBottom}px, above the sheet edge at ${narrow.peekTop}px, no scrolling needed`);
await assert(narrow.grabH >= 44, `360px: the grabber is ${narrow.grabH}px tall — a real thumb target`);
await pull(-100, '360px: pull the sheet up');
await assert((await expanded()) === 'true', '360px: the pull opens the sheet');
await qa.expectVisible('.sheetwrap', '360px: every fact is reachable through the sheet');
await pull(90, '360px: push the sheet back down');
await assert((await expanded()) === 'false', '360px: pushing down collapses it again');

// ==============================================================================================
// 6. Reduced motion.
// ==============================================================================================

await page.emulateMedia({ reducedMotion: 'reduce' });
await qa.goto('/profile', 'reload with reduced motion switched on');
await qa.expectVisible('.rail .rdoor', 'reduced motion: the rail still leads');
await qa.click('.pfgrab', 'reduced motion: tap the grabber');
await page.waitForTimeout(600);
await assert((await expanded()) === 'true', 'reduced motion: the sheet still opens');
await qa.expectVisible('#profileview', 'reduced motion: the facts are visible, not stranded behind a frozen transition');
await qa.click('.pfgrab', 'reduced motion: tap again to collapse');
await page.waitForTimeout(600);
await assert((await expanded()) === 'false', 'reduced motion: it still collapses');
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ==============================================================================================
// 7. Desktop 1280x800 — shape A must be untouched, in look AND behaviour.
// ==============================================================================================

await page.setViewportSize({ width: 1280, height: 800 });
await qa.goto('/profile', 'open the same profile on a desktop browser');
const shape = await page.evaluate(() => {
  const f = document.querySelector('.field').getBoundingClientRect();
  const r = document.querySelector('.rail').getBoundingClientRect();
  const head = document.querySelector('.pfsheet-head');
  const sheet = document.querySelector('.pfsheet');
  const body = document.querySelector('#profileview');
  return {
    sideBySide: r.left >= f.right - 2 && Math.abs(r.top - f.top) < 60,
    railW: Math.round(r.width),
    headDisplay: getComputedStyle(head).display,
    sheetDisplay: getComputedStyle(sheet).display,
    sheetPosition: getComputedStyle(sheet).position,
    sheetTransform: getComputedStyle(sheet).transform,
    bodyParentIsField: body.parentElement.closest('.field') !== null,
    bodyOffsetParentSameAsRail: true,
    role: sheet.getAttribute('role'),
    grabberVisible: head.offsetParent !== null,
  };
});
await assert(shape.sideBySide && (shape.railW === 320 || shape.railW === 360), `desktop shape A intact: field and rail side by side, rail ${shape.railW}px`);
await assert(shape.headDisplay === 'none' && shape.sheetDisplay === 'contents' && shape.sheetPosition === 'static',
  `desktop: the sheet is transparent to layout (head ${shape.headDisplay}, sheet ${shape.sheetDisplay}/${shape.sheetPosition})`);
await assert(shape.sheetTransform === 'none', 'desktop: no sheet transform is applied');
await assert(shape.role === null && !shape.grabberVisible, 'desktop: no phantom "Your facts" landmark, no grabber');
await shot('desktop-unchanged.png');

// The behaviour half of "unchanged" — the review must-fix.
await qa.click('button[aria-label="Sorted"]', 'desktop: click the ALREADY ACTIVE view toggle');
await escape('desktop: press Escape with nothing open');
await qa.click('button[aria-label="Constellation"]', 'desktop: switch view');
await escape('desktop: press Escape again');
const desktopLive = (await live()) ?? '';
await assert(!/Your facts (opened|closed)\./.test(desktopLive),
  `desktop: no sheet announcement ever reaches the live region (it read "${desktopLive}")`);
const stillClosed = await page.evaluate(() => ({
  openClass: document.querySelector('.pfsheet').classList.contains('open'),
  role: document.querySelector('.pfsheet').getAttribute('role'),
}));
await assert(!stillClosed.openClass && stillClosed.role === null, 'desktop: no sheet state and no sheet ARIA is ever set');
await qa.expectVisible('.sky', 'desktop: the constellation still renders in the field');
const heroHidden = await page.locator('.phead').isVisible();
await assert(!heroHidden, 'desktop: the Constellation view still has no hero, exactly as shipped');
await qa.click('button[aria-label="Sorted"]', 'desktop: back to Sorted');
await qa.expectVisible('.phead', 'desktop: the Sorted hero is back');

// ==============================================================================================
// 8. Plain international English on the new strings.
// ==============================================================================================

await page.setViewportSize({ width: 390, height: 844 });
await qa.goto('/profile', 'reload on a phone for a copy read');
const collapsedCopy = await page.evaluate(() => document.querySelector('.jobdeck').innerText);
await qa.click('.pfgrab', 'open the sheet for its copy');
const openCopy = await page.evaluate(() => document.querySelector('.jobdeck').innerText);
const all = `${collapsedCopy}\n${openCopy}`;
const banned = ['advert', 'hunt', 'leverage', 'circle back', 'low-hanging', 'drill down', 'reach out'];
const hits = banned.filter((w) => new RegExp(w, 'i').test(all));
await assert(hits.length === 0, `no jargon or idioms in the new phone copy (checked: ${banned.join(', ')})`);
await assert(!/\b(gold|grey|gray|amber)\b/i.test(all), 'no colour name in any copy');
await qa.note(`sheet edge copy: ${JSON.stringify(await page.locator('.pfsheet-head').innerText())}`);

const ok = await qa.finish();
console.log(`owner screenshots: ${path.resolve(OWNER)}`);
process.exit(ok ? 0 : 1);
