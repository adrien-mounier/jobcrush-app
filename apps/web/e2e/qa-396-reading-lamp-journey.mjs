// #396 — the reading lamp and the short "from X" tags, walked over the REAL stack (fake model only).
//
//   1. she pastes her CV with the review run HELD on the QA stack (POST /qa/stack reviewHold);
//   2. check mode is the reading screen: her CV on the sheet, the lamp band moving, the progress
//      segments, "About N minutes left." — at 390 and 1280 wide; no walk, no footer button;
//   3. a reload keeps her on the reading screen; under reduced motion the lamp holds still;
//   4. released, the walk opens by itself on "Your details" with focus on its heading;
//   5. the Skills screen and the profile page wear "from …" tags: one line each, nothing overflows.
//
// What the fake stack cannot show: a line moved in from a job or a summary (its miner answers one
// recorded CV with no tool line and no "fluent in" summary line). Step 5 therefore takes the REAL
// /review and /profile payloads and only sets `movedFrom` on four of her skills to real long names
// (BRED Banque Populaire, J.P. Morgan Chase & Co, Société Générale, your summary), so the layout is
// measured on the real render. The tag's words themselves are proven by check-mode.spec.ts.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30396
//   BASE_URL=http://127.0.0.1:30396 node apps/web/e2e/qa-396-reading-lamp-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30396';
const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.396@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated releases for four agile squads.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');
const FROMS = [
  { from: 'BRED Banque Populaire', shown: 'from BRED…' },
  { from: 'J.P. Morgan Chase & Co', shown: 'from J.P. Morgan…', copied: true },
  { from: 'Société Générale', shown: 'from Société Générale' },
  { from: 'your summary', shown: 'from your summary' },
];

const qa = await createSession('qa-396-reading-lamp', { baseURL: BASE, viewport: { width: 390, height: 844 } });
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const json = (p, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [p, init ?? null],
  );
const holdReview = (on) =>
  json('/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewHold: on }) });
const sizes = [{ width: 390, height: 844 }, { width: 1280, height: 900 }];
const noPageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Step 5's seam: real payloads, four skills given a real long "moved from" name (see header).
let augment = false;
function tagSkills(body) {
  let n = 0;
  for (const s of body?.sections ?? body?.domains ?? []) {
    if (!/skill/i.test(`${s.heading ?? ''} ${s.tag ?? ''}`)) continue;
    for (const l of s.lines ?? s.facts ?? []) {
      if (n >= FROMS.length) break;
      const f = FROMS[n++];
      l.movedFrom = f.from;
      if (f.copied) l.copied = true;
    }
  }
  return body;
}
for (const p of ['**/api/review', '**/api/profile']) {
  await page.route(p, async (route) => {
    if (!augment || route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    route.fulfill({ response: res, json: tagSkills(await res.json()) });
  });
}

const reading = page.locator('.check .reading');
const h1 = page.locator('main h1');
const primary = page.locator('.foot .primary');

/** Each moved tag: one line, inside its item, and the shown words. */
async function checkTags(scope, where) {
  const tags = page.locator(`${scope} .tag.moved`);
  const count = await tags.count();
  await assert(count === FROMS.length, `${where}: ${count} "from" tags on her skills`);
  for (let i = 0; i < count; i += 1) {
    const t = tags.nth(i);
    const m = await t.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const box = (el.closest('li') ?? el.closest('.fact') ?? el.parentElement).getBoundingClientRect();
      const shown = el.querySelector('[aria-hidden="true"]')?.textContent;
      const said = el.querySelector('.sr-only')?.textContent;
      const srHidden = getComputedStyle(el.querySelector('.sr-only')).position === 'absolute';
      return { lines: el.getClientRects().length, inside: r.right <= box.right + 1 && r.left >= box.left - 1, shown, said, title: el.title, srHidden };
    });
    const f = FROMS.find((x) => m.said?.endsWith(x.from));
    await qa.expectVisible(t, `${where}: "${m.shown}" — one line (${m.lines}), inside its item (${m.inside}), hover "${m.title}", reader hears "${m.said}" (hidden from sight: ${m.srHidden})`);
    await assert(!!f && m.shown === f.shown && m.lines === 1 && m.inside && m.title === m.said && m.srHidden, `${where}: tag "${m.shown}" is right and fits`);
  }
  await assert(await noPageOverflow(), `${where}: nothing runs off the page sideways`);
}

try {
  // 1. Her CV in, with the review held.
  await qa.goto('/', 'the front door');
  await assert((await holdReview(true)).status === 200, 'the QA stack holds the review run');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', 'IT project manager', 'the job she is going for');
  await qa.fill('#search-area', 'Singapore', 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
  await qa.goto('/discovery', 'discovery moves her on by itself');
  await page.waitForURL(/\/profile\/check/, { timeout: 30_000 });
  await reading.locator('h1').waitFor({ timeout: 30_000 });

  // 2. The reading screen, at both widths.
  for (const vp of sizes) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);
    const w = vp.width;
    await qa.expectText('.check .reading h1', 'Reading your CV', `${w}: the reading screen, not the walk`);
    await qa.expectText('.check .reading .sub', "I'm checking every line before you go through it.", `${w}: the line under the title`);
    await qa.expectText('.check .reading .sheet .name', 'Jane Doe', `${w}: the sheet is her own CV`);
    await qa.expectVisible('.check .reading .sheet', `${w}: the paper sheet`);
    await qa.expectVisible('.check .reading .lamp', `${w}: the lamp band on the sheet`);
    const rows = await page.locator('.check .reading .sheet p').count();
    const inked = await page.locator('.check .reading .sheet p.inked').count();
    await qa.note(`${w}: ${rows} lines of her CV on the sheet, ${inked} inked so far (the held run has landed no unit yet)`);
    await qa.expectVisible('.check .reading .readprog', `${w}: the progress segments`);
    const segs = await page.locator('.check .reading .readprog i').count();
    const done = await page.locator('.check .reading .readprog i.done').count();
    const prog = (await json('/review')).body?.progress;
    await assert(prog && segs === prog.total && done === prog.done, `${w}: one segment per unit of the run (${segs} segments, ${done} done; the server says ${prog?.done}/${prog?.total})`);
    const left = (await page.locator('.check .reading .left').textContent()) ?? '';
    await qa.expectVisible('.check .reading .left', `${w}: "${left}"`);
    await assert(/^About (a minute|\d+ minutes) left\.$/.test(left), `${w}: the minutes left read right`);
    await assert((await page.locator('.check .guide, .check .foot').count()) === 0, `${w}: no walk, no footer button`);
    await assert(await noPageOverflow(), `${w}: nothing runs off the page sideways`);
    const sheet = await page.locator('.check .reading .sheet').boundingBox();
    await assert(sheet && sheet.y + sheet.height <= vp.height, `${w}: the sheet fits the screen (bottom at ${Math.round(sheet?.y + sheet?.height)} of ${vp.height})`);
  }
  await assert(await page.evaluate(() => document.activeElement?.textContent === 'Reading your CV'), 'focus sits on "Reading your CV"');

  // The lamp moves (normal motion): its position changes between two looks.
  const lampY = () => page.locator('.check .reading .lamp').evaluate((el) => el.getBoundingClientRect().top);
  const y1 = await lampY();
  await page.waitForTimeout(1200);
  const y2 = await lampY();
  const anim = await page.locator('.check .reading .lamp').evaluate((el) => getComputedStyle(el).animationName);
  await assert(anim === 'read-sweep' && Math.abs(y2 - y1) > 2, `the lamp sweeps down the page (${anim}; ${Math.round(y1)} → ${Math.round(y2)})`);
  await qa.scrollThrough('she watches her CV being read');

  // 3. A reload keeps her here; reduced motion holds the lamp still.
  await qa.goto('/profile/check', 'she reloads while it runs');
  await qa.expectText('.check .reading h1', 'Reading your CV', 'still the reading screen after the reload');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(500);
  const r1 = await lampY();
  await page.waitForTimeout(1500);
  const r2 = await lampY();
  const still = await page.locator('.check .reading .lamp').evaluate((el) => ({ a: getComputedStyle(el).animationName, s: getComputedStyle(el.parentElement).animationName }));
  await qa.expectVisible('.check .reading .lamp', `reduced motion: the lamp parked (${Math.round(r1)} → ${Math.round(r2)}, lamp animation ${still.a}, sheet animation ${still.s})`);
  await assert(still.a === 'none' && still.s === 'none' && Math.abs(r2 - r1) < 0.5, 'reduced motion: nothing moves');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 4. Released, the walk opens by itself.
  augment = true;
  await assert((await holdReview(false)).status === 200, 'the review run is let through');
  await page.locator('.check .guide h1').waitFor({ timeout: 60_000 });
  await qa.expectText(h1, 'Your details', 'the walk opens on Your details by itself');
  await assert(await page.evaluate(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === 'Your details'), 'focus lands on its heading');
  await assert((await reading.count()) === 0, 'the reading screen is gone');
  await assert((await json('/review')).body?.progress === null, 'the server says the run is over');
  await qa.expectVisible('input[name=name]', 'her details, filled');

  // 5. Skills: the "from" tags, at both widths.
  for (let i = 0; i < 14 && !/^Skills/.test((await h1.textContent()) ?? ''); i += 1) {
    // a screen holding suggestions: answer each the quiet way (No thanks / Keep it), then go on
    for (let k = 0; k < 10 && (await primary.isDisabled()); k += 1) {
      const b = page.locator('main li.sg').getByRole('button', { name: /^(No thanks|Keep it)$/ }).first();
      if (!(await b.count())) break;
      await b.click();
      await page.waitForTimeout(400);
    }
    await primary.click();
    await page.waitForTimeout(400);
  }
  await assert(/^Skills/.test((await h1.textContent()) ?? ''), 'the Skills screen');
  for (const vp of sizes) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);
    await checkTags('main', `Skills ${vp.width}`);
  }

  // Finish check mode (the profile shows her facts once it is finished).
  for (let i = 0; i < 14 && !/Finish my profile/.test((await primary.textContent()) ?? ''); i += 1) {
    for (let k = 0; k < 10 && (await primary.isDisabled()); k += 1) {
      const b = page.locator('main li.sg').getByRole('button', { name: /^(No thanks|Keep it)$/ }).first();
      const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
      if (await b.count()) await b.click();
      else if (await pill.count()) await pill.click();
      else break;
      await page.waitForTimeout(400);
    }
    if (/Finish my profile/.test((await primary.textContent()) ?? '')) break;
    await primary.click();
    await page.waitForTimeout(400);
  }
  const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
  if ((await primary.isDisabled()) && (await pill.count())) await qa.click(pill, 'where she can work: yes');
  await qa.click(primary, 'Finish my profile');
  await page.locator('.donepanel').waitFor();

  // The profile page, at both widths.
  await qa.goto('/profile', 'her profile');
  await page.locator('.profile .fact').first().waitFor();
  for (const vp of sizes) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);
    await qa.scrollThrough(`the profile at ${vp.width}`);
    // on a phone her facts sit in the pull-up sheet: tap its grabber to open it
    if (vp.width < 600 && (await page.locator('.pfgrab').isVisible())) {
      await qa.click('.pfgrab', 'open the "Your facts" sheet');
      await page.waitForTimeout(800);
    }
    await checkTags('.profile', `Profile ${vp.width}`);
  }
} catch (err) {
  await qa.note(`aborted: ${err.message}`);
  await assert(false, 'the journey ran to its end');
} finally {
  try { await holdReview(false); } catch { /* page gone */ }
}
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
