// #23 Tailor (screen 3) — the full journey, human-paced, over a REAL stack. #415 (ADR-0020): the
// step asks nothing about the job's requirements — with nothing open about eligibility the draft is
// the first thing the person sees, beside "Also asked, not on your CV" and the "Where you fit" sheet.
//
// Unlike tailor.spec.ts / deck.spec.ts (which mock at the route layer), nothing here is stubbed:
// discovery -> reveal -> sign-in -> deck -> swipe right -> /tailor -> the draft -> the sheet -> the
// exits all run against the live Fastify API. No ANTHROPIC_API_KEY is needed — the fake-model QA
// stack drafts for free.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/tailor-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `tailor-journey-${Date.now()}@example.com`;

const qa = await createSession('tailor-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

// The tailor screen is `fixed inset:0` with its own inner scroller, so window scrolling is a no-op —
// scroll the given scroller the way a thumb would instead, and pause so lazy work shows.
async function readThrough(sel, note) {
  await qa.note(note);
  await page.evaluate(async (s) => {
    const el = document.querySelector(s);
    if (!el) return;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
    el.scrollTo({ top: 0, behavior: 'smooth' });
  }, sel);
  await page.waitForTimeout(900);
}

const pct = async () => {
  const label = await page.getByRole('img', { name: /% match/ }).first().getAttribute('aria-label');
  return Number(label.replace(/\D/g, ''));
};

// Record a pass/fail into the report without aborting the run, so one defect never costs us the
// evidence for every later step. '' is always contained (pass); the sentinel never is (fail).
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);

// ---------------------------------------------------------------------------------------------
// 0. Seed the session the way deck.spec.ts does: real API calls made IN-PAGE (the session cookie
//    is Secure, so only the browser context carries it over loopback), including the real
//    magic-link sign-in the #22 wall requires. These are the live endpoints, not route mocks.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await page.waitForTimeout(700);

await qa.note('start discovery, bring her CV + sign in over the real magic-link path');
await page.evaluate(
  async ({ role }) =>
    fetch('/api/onboarding/discovery/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then(() => undefined),
  { role: ROLE },
);
// #339: her read, reviewed CV gives her deck its facts (a deck with no facts grades every
// requirement 0 and has no "Where you fit" to show).
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
await qa.note(`her CV was read and reviewed — ${facts} facts on her record`);
const seeded = await page.evaluate(async ({ email }) => {
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  // /auth/request-link is rate-limited 5 per 15 min per IP — a 429 here silently leaves the session
  // anonymous and every later step fails in a confusing way, so surface it as itself.
  if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
  const token = new URL('http://x' + link.devLink).searchParams.get('token');
  await post('/api/auth/verify', { token });
  return 'ok';
}, { email: EMAIL });
if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);

// ---------------------------------------------------------------------------------------------
// 1. /tailor with nothing being tailored — graceful redirect, never a crash or a blank screen.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'open /tailor directly with no job being tailored');
await page.waitForURL('**/deck', { timeout: 10_000 });
await qa.expectVisible('.jobdeck', 'no tailor target redirects to /deck (409 handled, not a crash)');

// ---------------------------------------------------------------------------------------------
// 2. The reveal -> the deck card (the card renderer lives in jobcard.tsx: the ring, the three
//    lists and the folded ad must be unchanged, and no row carries a door).
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.expectVisible(page.getByRole('heading', { name: /matched you/ }), 'the reveal headline');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');

await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the score ring renders');
await qa.expectVisible(page.getByRole('heading', { name: 'Where you fit' }), 'DECK: "Where you fit"');
await qa.expectVisible(page.getByRole('heading', { name: "Where you don't — yet" }), 'DECK: "Where you don\'t — yet"');
await qa.expectVisible('details.ad', 'DECK: the ad is folded shut, last');
await qa.scrollThrough('read the deck card top to bottom');
const doorsOnDeck = await page.getByRole('button', { name: 'Changed? Add it' }).count();
await assert(doorsOnDeck === 0, `#415: no "Changed? Add it" door on the deck card (count: ${doorsOnDeck})`);

await qa.note('DECK: the three mark glyphs are gold check / grey ? / dim dot — never a cross');
const deckMarks = await page.locator('.mk').allTextContents();
await assert(!deckMarks.some((m) => /[✗✕×xX]/.test(m)), `DECK marks = ${JSON.stringify(deckMarks)} — no cross glyph present`);

// swipe left once (the deck's own control still works), then back on to a card
await qa.click(page.getByRole('button', { name: 'Not for me, show next job' }), 'DECK: swipe left — next card');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the next card rendered');
const deckPct = await pct();
const deckTitle = (await page.locator('.jobcard h2').first().textContent()).trim();

// ---------------------------------------------------------------------------------------------
// 3. Swipe right -> the handoff bridge -> /tailor
// ---------------------------------------------------------------------------------------------
// The bridge holds for ~800ms before navigating, which is shorter than this driver's own pacing —
// so sample it immediately rather than asserting on it after a pause.
const bridgeSeen = page
  .getByRole('heading', { name: 'Tailoring this one' })
  .waitFor({ state: 'visible', timeout: 8000 })
  .then(() => true)
  .catch(() => false);
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'DECK: swipe right — I want this one');
await assert(await bridgeSeen, 'the handoff bridge shows before it navigates');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await qa.expectVisible('.jobdeck.tailor', 'the bridge navigated to /tailor');

// ---------------------------------------------------------------------------------------------
// 4. ADR-0020 clause 1 — nothing open about eligibility on this job, so NO question screen: the
//    CV is being written, then the draft is the page.
// ---------------------------------------------------------------------------------------------
const state = await api('/api/onboarding/tailor');
await qa.note(`GET /onboarding/tailor — ${state.card.matchPct}% · questions ${JSON.stringify(state.questions.map((q) => q.kind ?? 'advert'))} · requirements ${state.requirements.length}`);
await assert(state.questions.every((q) => q.kind === 'profile'), 'API: the queue holds profile questions only — a requirement is never a question');
await assert(!('ledger' in state) && !('doors' in state) && !('closedGaps' in state), 'API: the ledger, the doors and the closed-gaps tally are gone from the wire');
if (state.questions.length > 0) {
  // A work-rights or language question this advert left open (the QA stack's language adverts
  // armed by an earlier run): answer it the way a person would, then the draft follows.
  await qa.expectVisible('.tailor .ask .q', `a profile question is open first: "${await page.locator('.tailor .ask .q').textContent()}"`);
  await qa.click(page.locator('.tailor .opts .opt').first(), 'answer the profile question — once, for every job');
  await page.waitForTimeout(1400);
}
await assert((await page.locator('.tailor .ask .q').count()) === 0, 'ADR-0020 clause 1: no question screen — nothing is asked about the job itself');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is the page — written by itself, without a press');
await qa.expectVisible(page.getByRole('heading', { name: deckTitle }), `the job heads the screen ("${deckTitle}")`);
const tailorPct = await pct();
await assert(tailorPct === deckPct, `#397: one job, one number — deck ${deckPct}% · tailor ${tailorPct}%`);
const bodyText = await page.locator('.tailor').innerText();
await assert(!/\+\d+%/.test(bodyText) && !/I'm done/.test(bodyText) && !/Changed\? Add it/.test(bodyText) && !/Does that describe you/.test(bodyText),
  '#415: no "+N%", no "I\'m done", no "Changed? Add it", no "Does that describe you?" anywhere on the screen');
await readThrough('.tailor .dgrid', 'read the draft and the rail beside it');

// ---------------------------------------------------------------------------------------------
// 5. ADR-0020 clause 6 — "Also asked, not on your CV": the job's unmet requirements, in the job's
//    order, with no button.
// ---------------------------------------------------------------------------------------------
const gaps = state.requirements.filter((r) => r.state === 'gap');
await qa.note(`requirements in the job's order: ${JSON.stringify(state.requirements.map((r) => `${r.state}: ${r.text.slice(0, 40)}`))}`);
const gapRegion = page.getByRole('region', { name: 'Also asked, not on your CV' });
if (gaps.length > 0) {
  await qa.expectVisible(gapRegion, `"Also asked, not on your CV" lists ${gaps.length} requirement(s)`);
  const shown = await gapRegion.getByRole('listitem').allTextContents();
  await assert(JSON.stringify(shown) === JSON.stringify(gaps.map((g) => g.text)), `the list is the job's own order, verbatim: ${JSON.stringify(shown)}`);
  await assert((await gapRegion.getByRole('button').count()) === 0 && (await gapRegion.getByRole('link').count()) === 0, 'the list carries no button (the chat door is #350)');
} else {
  await assert((await gapRegion.count()) === 0, 'nothing unmet — the list is omitted, not shown empty');
}

// ---------------------------------------------------------------------------------------------
// 6. "Where you fit" — a pull-up on a phone, every requirement in the job's order.
// ---------------------------------------------------------------------------------------------
const met = state.requirements.filter((r) => r.state === 'met').length;
await qa.click(page.getByRole('button', { name: `Where you fit · ${met} of ${state.requirements.length}` }), 'open "Where you fit"');
const sheet = page.getByRole('dialog', { name: /Where you fit/ });
await qa.expectVisible(sheet, 'the sheet opens');
const rows = await sheet.locator('.marks li .t').allTextContents();
await assert(JSON.stringify(rows) === JSON.stringify(state.requirements.map((r) => r.text)), `every requirement, in the job's order (${rows.length})`);
const box = await sheet.boundingBox();
await assert(box && Math.round(box.width) === 430 && Math.round(box.y + box.height) === 932 && box.y > 0, `on a phone it is a pull-up (box ${JSON.stringify(box)})`);
await readThrough('.tailor .marks', 'read the sheet top to bottom');
await page.keyboard.press('Escape');
await assert((await sheet.count()) === 0, 'Escape closes the sheet');

// ---------------------------------------------------------------------------------------------
// 7. Reload — the draft is a checkpoint, the screen is the same, nothing is re-asked.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is back at once — a checkpoint, nothing re-spent');
await assert((await page.locator('.tailor .ask .q').count()) === 0, 'a reload asks nothing');
await assert((await pct()) === tailorPct, `the number survived the reload (${tailorPct}%)`);

// ---------------------------------------------------------------------------------------------
// 8. The exits: Approve (the one press, approve-is-send-journey's job), Save, Drop.
// ---------------------------------------------------------------------------------------------
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), '#313: the one approve-is-send press, under the draft');
await qa.expectVisible(page.getByRole('button', { name: 'Save it and come back later' }), 'Save (secondary)');
await qa.expectVisible(page.getByRole('button', { name: 'Drop this job' }), 'Drop is available');

await qa.click(page.getByRole('button', { name: 'Drop this job' }), 'Drop this job');
await qa.expectText('.tailor .exits.confirming .notice', 'Everything you told me stays on your profile.', 'the reassurance copy, verbatim');
// #419: exact — "It's true: keep it on my CV for every job" also names "keep it".
await qa.click(page.getByRole('button', { name: 'Keep it', exact: true }), 'Keep it — the job is not dropped');
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), 'still on the draft after Keep it');

await qa.click(page.getByRole('button', { name: 'Save it and come back later' }), 'Save it and come back later (secondary)');
await qa.expectVisible(page.getByRole('heading', { name: 'Saved' }), 'Save lands its own holding beat');
await qa.click(page.getByRole('button', { name: 'Back to the deck' }), 'back to the deck');

await qa.goto('/tailor', 'return once more to actually drop it');
await page.waitForTimeout(800);
await qa.click(page.getByRole('button', { name: 'Drop this job' }), 'Drop this job');
await qa.click(page.getByRole('button', { name: 'Drop it' }), 'Drop it — confirm');
await page.waitForURL('**/deck', { timeout: 10_000 });
await qa.expectVisible('.jobdeck', 'Drop returns to the deck');

// /discovery hands off to the deck once nothing is left to ask, so read the record itself:
// discovery's own cvLines + factCount are "everything you told me", session-wide.
const profile = await page.evaluate(async () => {
  const d = await (await fetch('/api/onboarding/discovery')).json();
  return { cvLines: d.cvLines.length, factCount: d.factCount };
});
await assert(
  profile.factCount >= 1 && profile.cvLines >= 1,
  `"everything you told me stays on your profile" — after the drop the profile still holds ${profile.factCount} facts / ${profile.cvLines} CV lines`,
);

// ---------------------------------------------------------------------------------------------
// 9. A second job: the draft is first there too — the same screen for every job.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'pick a second job');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.click(page.getByRole('button', { name: 'Not for me, show next job' }), 'swipe past the job just dropped');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right on a fresh job');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question this job left open — answer it once');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the second job goes straight to its draft too');
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), 'with the same one press');

// ---------------------------------------------------------------------------------------------
// 10. Keyboard-only + reduced motion.
// ---------------------------------------------------------------------------------------------
await qa.note('keyboard-only: the sheet and the drop confirm from the keyboard');
await page.getByRole('button', { name: /Where you fit/ }).focus();
await page.keyboard.press('Enter');
await qa.expectVisible(page.getByRole('dialog', { name: /Where you fit/ }), 'Enter on the trigger opens the sheet');
const sheetFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await assert(sheetFocus === 'Close', `focus moves into the sheet, on "${sheetFocus}"`);
await page.keyboard.press('Escape');
const backFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await assert(/Where you fit/.test(backFocus), `Escape closes it and returns focus to "${backFocus}"`);

await qa.click(page.getByRole('button', { name: 'Drop this job' }), 'open the drop confirm');
const confirmFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await qa.note(`focus moves to "${confirmFocus}" inside the drop confirm`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const escFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await qa.expectVisible(page.getByRole('button', { name: 'Drop this job' }), `Esc keeps the job and returns focus to "${escFocus}"`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
