// #392 follow-up (owner, 2026-10-16) — discovery is only the loading wait, then the flow moves on by
// itself. Left by the #392b QA gate. Walked over the REAL stack (fake model only):
//
//   A. front door: she pastes her CV, says what she is going for and where, presses Save and
//      continue; discovery shows the #257 confirmation line ("We'll look for … in …") and
//      "Finding jobs like yours…", the count ticks up, and she lands on check mode by herself —
//      no Continue, no "Your search is set." anywhere. Back from check mode never stops on the
//      wait screen. Walked twice: normal motion and reduced motion (no tick: one number only).
//   B. question 1 on discovery (no CV, no front door): "Loading your questions…" first, then the
//      question; she answers, the count ticks, she lands on the deck by herself; Back does not
//      land on the wait.
//
// The discovery read answers in one go on the fake stack, so the browser holds it ~2 s (the server
// still answers for real) — only so the wait box can be seen and photographed.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/qa-392b-auto-advance-journey.mjs
import { createSession, SAMPLE_CV } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const ROLE = 'IT project manager';
const AREA = 'Singapore';
const MOVED_ON = /\/(deck|profile\/check)/;
const assert = (qa, cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Everything discovery ever shows, recorded inside the page so nothing races the ~2 s auto-advance.
const recordDiscovery = (page) =>
  page.addInitScript(() => {
    const seen = (window.seen = { counts: [], intent: null, finding: false, loadingQs: false, cont: false, set: false, handoff: false });
    new MutationObserver(() => {
      if (!location.pathname.startsWith('/discovery')) return;
      const d = document.querySelector('.discovery');
      if (!d) return;
      const txt = d.textContent;
      if (txt.includes('Finding jobs like yours')) seen.finding = true;
      if (txt.includes('Loading your questions')) seen.loadingQs = true;
      if (txt.includes('Your search is set')) seen.set = true;
      if (d.querySelector('.handoff')) seen.handoff = true;
      if ([...d.querySelectorAll('button')].some((b) => /continue/i.test(b.textContent))) seen.cont = true;
      const il = d.querySelector('.intent-context')?.textContent;
      if (il) seen.intent = il;
      const n = d.querySelector('.promise .n')?.textContent;
      if (n && /^\d+$/.test(n) && n !== seen.counts.at(-1)) seen.counts.push(n);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

const holdDiscoveryRead = (page) =>
  page.route('**/api/onboarding/discovery', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, 2000));
    await route.fulfill({ response: res });
  });

async function frontDoor(name, reduced) {
  const qa = await createSession(name, { baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const { page } = qa;
  page.setDefaultTimeout(20_000);
  try {
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordDiscovery(page);
    await qa.goto('/', `the front door${reduced ? ' (reduced motion)' : ''}`);
    const jobId = await qa.frontDoorPaste(SAMPLE_CV, 'she pastes her CV');
    await qa.waitForJobDone(jobId);
    await qa.frontDoorContinueToIntent();
    await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
    await qa.fill('#search-area', AREA, `where: ${AREA}`);
    await qa.press('#search-area', 'Enter', 'place the area chip');
    await holdDiscoveryRead(page);
    await page.locator('button:has-text("Save and continue")').click();
    await page.waitForURL(/\/discovery/);
    await page.getByText('Finding jobs like yours').waitFor();
    await qa.expectText('.discovery .loadstate', 'Finding jobs like yours', 'discovery: the wait box, while her search runs');
    await qa.expectVisible('.discovery .intent-context', 'the confirmation of what she asked for sits above it');
    await page.locator('.promise:not(.blind) .n').waitFor();
    if (!reduced) await qa.expectVisible('.promise:not(.blind)', 'the count box as it lands');
    const t0 = Date.now();
    await page.waitForURL(MOVED_ON, { timeout: 30_000 });
    const held = Date.now() - t0;
    const seen = await page.evaluate(() => window.seen);
    const counts = seen.counts.map(Number);
    qa.note(`discovery showed: ${JSON.stringify(seen)}; landed on ${new URL(page.url()).pathname} ~${held} ms after the count appeared`);
    await assert(qa, /We[’']ll look for/.test(seen.intent ?? '') && seen.intent.includes(AREA), `the confirmation line read "${seen.intent}"`);
    await assert(qa, seen.finding, 'she saw "Finding jobs like yours…"');
    qa.note(`"Loading your questions…" flashed before the wait box on this front-door arrival: ${seen.loadingQs}`);
    await assert(qa, counts.length > 0 && counts.at(-1) > 0, `a real count landed (${counts.join(' → ')})`);
    if (reduced) await assert(qa, counts.length === 1, `reduced motion: one number only, no tick (${counts.join(',')})`);
    else await assert(qa, counts[0] === 0 && counts.length > 3 && counts.every((v, i) => !i || v >= counts[i - 1]), `the count ticked up from 0 (${counts.length} steps)`);
    await assert(qa, !seen.cont && !seen.set && !seen.handoff, 'no Continue, no "Your search is set.", no hand-off — at any moment');
    await assert(qa, /\/profile\/check/.test(page.url()), `she lands on check mode by herself (${new URL(page.url()).pathname})`);
    await qa.expectVisible('main h1', 'check mode opened');
    await qa.scrollThrough('read check mode');

    // Back: the wait screen was replaced, so Back goes to what came before it.
    const trail = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && trail.push(new URL(f.url()).pathname));
    await page.goBack();
    await page.waitForTimeout(4000);
    qa.note(`after Back the browser went through: ${trail.join(' → ')}; now on ${new URL(page.url()).pathname}`);
    await assert(qa, !/\/discovery/.test(new URL(page.url()).pathname), `Back does not leave her on the wait screen (now ${new URL(page.url()).pathname})`);
    await qa.scrollThrough('where Back left her');
  } catch (e) {
    await assert(qa, false, `run error: ${e.message}`);
  }
  return qa.finish();
}

async function question1(name) {
  const qa = await createSession(name, { baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const { page } = qa;
  page.setDefaultTimeout(20_000);
  try {
    await recordDiscovery(page);
    await qa.context.clearCookies();
    await qa.goto('/', 'a new visitor on the front door (so Back has somewhere to go)');
    await holdDiscoveryRead(page);
    await page.goto(`${BASE}/discovery`);
    await qa.expectText('.discovery .loadstate', 'Loading your questions', 'about to be asked question 1: "Loading your questions…"');
    await page.locator('#q1-role').waitFor();
    await qa.expectVisible('#q1-role', 'question 1 is asked');
    await qa.scrollThrough('read question 1');
    await qa.fill('#q1-role', ROLE, `she types "${ROLE}"`);
    await page.locator('button.go.wide').click();
    await page.locator('.promise:not(.blind) .n').waitFor();
    await qa.expectVisible('.promise:not(.blind)', 'the count lands in the wait box');
    await page.waitForURL(MOVED_ON, { timeout: 30_000 });
    const seen = await page.evaluate(() => window.seen);
    qa.note(`discovery showed: ${JSON.stringify(seen)}`);
    await assert(qa, seen.loadingQs && !seen.cont && !seen.set && !seen.handoff, 'no Continue / hand-off at any moment; "Loading your questions…" was shown first');
    await assert(qa, /\/deck/.test(page.url()), `no CV to check: she lands on the deck by herself (${new URL(page.url()).pathname})`);
    await qa.scrollThrough('the deck');
    await page.goBack();
    await page.waitForTimeout(3000);
    await assert(qa, !/\/discovery/.test(new URL(page.url()).pathname), `Back does not land on the wait screen (now ${new URL(page.url()).pathname})`);
  } catch (e) {
    await assert(qa, false, `run error: ${e.message}`);
  }
  return qa.finish();
}

const ok =
  (await frontDoor('qa-392b-front-door', false)) &
  (await frontDoor('qa-392b-front-door-reduced-motion', true)) &
  (await question1('qa-392b-question-1'));
process.exit(ok ? 0 : 1);
