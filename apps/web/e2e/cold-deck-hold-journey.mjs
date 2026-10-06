// #116 — a brand-new visitor's FIRST deck on a cold pool: the reveal is HELD while adverts are still
// being read, then shown ONCE with the whole count. Never "Couldn't line up your jobs.".
//
// What staging showed the owner on 2026-10-01: every advert in his first search was brand-new, the
// read phase gave each concurrency wave its own 15s, two waves reached the web proxy's 30s, the proxy
// reset the socket, and his first screen was the error. The owner's decision (option A): the honest
// "Still looking for your jobs…" screen stays up and re-asks, the deck is revealed once with the full
// count, and the read phase shares ONE wall-clock budget so no response outlives the proxy.
//
// The QA stack answers advert reads instantly, so this journey arms qa-main.ts's readDelayMs knob
// ABOVE the deck's 15s read budget for its own run and puts it back at the end (and on a crash).
// Each advert's first read is slowed once per arming; a re-ask joins the running read.
//
// Run (the Tier 2 stack: fake-model API behind the web's /api proxy):
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build && pnpm --filter @jobcrush/web start
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/cold-deck-hold-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const READ_DELAY_MS = Number(process.env.QA_READ_DELAY_MS ?? 20000); // above the deck's 15s budget
const PROXY_LIMIT_MS = 30000; // Next's rewrite proxyTimeout default
const ROLE = 'IT project manager';
const AREA = 'Hong Kong';
const CV_TEXT = [
  'Marta Kowalska',
  'marta.kowalska@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2016 - Present',
  '- Led the checkout replatforming end to end and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams and reported to the steering group.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2011 - Feb 2016',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2011',
].join('\n');

const STILL = 'Still looking for your jobs…';
const ERROR = "Couldn't line up your jobs.";

const qa = await createSession('cold-deck-hold-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20000);

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const inPage = (method, path, data) =>
  page.evaluate(
    async ([m, p, d]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        headers: d ? { 'content-type': 'application/json' } : {},
        body: d ? JSON.stringify(d) : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON is itself evidence */ }
      return { status: res.status, json };
    },
    [method, path, data ?? null],
  );
const counters = async () => (await inPage('GET', '/ops/counters')).json ?? {};
const setReadDelay = async (ms) => {
  if (!page.url().startsWith('http')) await page.goto('/');
  return inPage('POST', '/qa/stack', { readDelayMs: ms });
};

let disarmed = false;
const disarm = async () => {
  if (disarmed) return;
  disarmed = true;
  const r = await setReadDelay(0);
  await qa.note(`disarmed the read delay: HTTP ${r.status}, readDelayMs now ${r.json?.readDelayMs}`);
};
let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    if (aborted) return;
    aborted = true;
    console.error(`\n[${ev}]`, e?.stack ?? e);
    try { await disarm(); } catch {}
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

// ---- 1. Arm the cold pool BEFORE her first deck read ----------------------------------------
const armed = await setReadDelay(READ_DELAY_MS);
await assertTrue(
  armed.status === 200 && armed.json?.readDelayMs === READ_DELAY_MS,
  `armed: every advert's first read now takes ${READ_DELAY_MS}ms, above the deck's 15s budget (HTTP ${armed.status}, echoed ${armed.json?.readDelayMs})`,
);
const before = await counters();

// ---- 2. The walk a brand-new visitor takes: CV in, intent, discovery floor --------------------
await page.context().clearCookies();
await qa.frontDoorPaste(CV_TEXT, 'the front door — a brand-new visitor pastes her CV');
await qa.completeReview(); // #338: a brought CV is reviewed before any job is shown (ADR-0016 clause 6)
await qa.frontDoorContinueToIntent();
if (await page.locator('#target-role').count()) {
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1200);
}
await qa.goto('/discovery', 'into discovery');
if (await page.locator('#q1-role').count()) {
  await qa.fill('#q1-role', ROLE, 'question 1: the role she is going for');
  await qa.click('button.go.wide', 'send question 1');
  await page.waitForTimeout(2500);
}
const asked = await qa.answerFloorOnScreen();
await qa.note(`the floor questions her screen put to her: ${asked.join(', ') || '(none)'}`);

// ---- 3. The cold deck: held, honest, then revealed once ---------------------------------------
const cardResponses = [];
const started = new Map();
page.on('request', (r) => { if (r.url().includes('/api/onboarding/cards') && r.method() === 'GET') started.set(r, Date.now()); });
page.on('requestfinished', async (r) => {
  if (!started.has(r)) return;
  const ms = Date.now() - started.get(r);
  let body = null;
  try { body = await (await r.response())?.json(); } catch {}
  cardResponses.push({ ms, status: (await r.response())?.status(), searching: body?.searching, cards: body?.cards?.length });
});
page.on('requestfailed', (r) => { if (started.has(r)) cardResponses.push({ ms: Date.now() - started.get(r), status: 'FAILED', error: r.failure()?.errorText }); });

const screenText = async () =>
  ((await page.locator('main, body').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const t0 = Date.now();
await page.goto('/deck', { waitUntil: 'domcontentloaded' });
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);

const timeline = [];
let sawError = false;
let revealCount = null;
let stillShotAfterBudget = false;
let stillShotEarly = false;
const revealCountsSeen = new Set();
while (Date.now() - t0 < 90000) {
  const text = await screenText();
  const state = /just matched you/.test(text) ? 'reveal' : text.includes(STILL) ? 'still' : text.includes(ERROR) ? 'error' : text.slice(0, 40);
  if (timeline.length === 0 || timeline[timeline.length - 1].state !== state) timeline.push({ at: secs(), state });
  if (state === 'error') sawError = true;
  if (state === 'still' && !stillShotEarly && Date.now() - t0 > 3000) {
    stillShotEarly = true;
    await qa.expectText('.loadstate', STILL, `t=${secs()}s — the honest wait screen is up (no cards, no count, no error)`);
  }
  if (state === 'still' && !stillShotAfterBudget && Date.now() - t0 > 17000) {
    stillShotAfterBudget = true;
    await qa.expectText('.loadstate', STILL, `t=${secs()}s — still holding PAST the 15s read budget, still no error screen`);
  }
  if (state === 'reveal') {
    const m = text.match(/(\d+) jobs? just matched you/);
    revealCount = m ? Number(m[1]) : null;
    revealCountsSeen.add(revealCount);
    break;
  }
  if (state === 'error') break;
  await page.waitForTimeout(500);
}
await qa.note(`screen timeline (seconds after opening /deck): ${timeline.map((s) => `${s.at}s ${s.state}`).join(' → ')}`);
await assertTrue(stillShotAfterBudget, 'the wait screen was seen holding beyond the 15s budget (the arming worked)');
await assertTrue(!sawError, `"${ERROR}" never appeared`);
await assertTrue(revealCount !== null && revealCount > 0, `t=${secs()}s — the deck was revealed without a manual reload: "${revealCount} jobs just matched you"`);
await qa.expectVisible(page.getByText(/jobs? just matched you/).first(), `the single reveal, with the whole count (${revealCount})`);
await qa.scrollThrough('she reads the reveal');

// Watch a few more seconds: the count must not change under her (revealed ONCE, whole).
await page.waitForTimeout(4000);
const later = await screenText();
const laterCount = Number((later.match(/(\d+) jobs? just matched you/) ?? [])[1] ?? NaN);
await assertTrue(laterCount === revealCount, `4s later the count is unchanged (${revealCount} → ${laterCount}) — no second reveal`);

// ---- 4. Over the wire: every response inside the proxy limit, held ones say so ----------------
await qa.note(`GET /onboarding/cards responses, in order: ${JSON.stringify(cardResponses)}`);
await assertTrue(
  cardResponses.length > 0 && cardResponses.every((r) => r.status === 200 && r.ms < PROXY_LIMIT_MS),
  `every deck response came back 200 well inside the proxy's 30s (slowest ${Math.max(...cardResponses.map((r) => r.ms))}ms)`,
);
const held = cardResponses.filter((r) => r.searching === true && r.cards === 0);
await assertTrue(held.length >= 1, `at least one response was a held "still looking" (${held.length})`);
const revealing = cardResponses.filter((r) => r.cards > 0);
await assertTrue(
  revealing.length >= 1 && revealing[0].cards === revealCount && cardResponses.every((r) => !(r.cards > 0 && r.cards < revealCount)),
  `no response ever carried a short deck — the first non-empty one carried the whole ${revealCount}`,
);

const warm = await inPage('GET', '/onboarding/cards');
await assertTrue(
  warm.json?.searching === false && warm.json?.cards?.length === revealCount,
  `a warm re-read agrees: ${warm.json?.cards?.length} cards, searching=${warm.json?.searching} — the revealed count was whole`,
);

const after = await counters();
const d = (k) => (after[k] ?? 0) - (before[k] ?? 0);
await qa.note(
  `counter deltas this run: deck.reveal_held +${d('deck.reveal_held')}, postings.read_timed_out +${d('postings.read_timed_out')}, ` +
    `postings.read_in_time +${d('postings.read_in_time')}, postings.read_failed +${d('postings.read_failed')}`,
);
await assertTrue(d('deck.reveal_held') >= 1, `deck.reveal_held rose (+${d('deck.reveal_held')})`);
await assertTrue(d('postings.read_failed') === 0, `postings.read_failed did not move (+${d('postings.read_failed')}) — a slow read is not a failed one`);

await disarm();
const ok = await qa.finish();
console.log(`report: ${qa.runDir}/report.html`);
process.exit(ok ? 0 : 1);
