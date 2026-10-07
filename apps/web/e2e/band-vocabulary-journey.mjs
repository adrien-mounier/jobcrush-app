// #102 "move the app onto the v1 requirement contract" — the user-invisibility journey.
//
// The slice renamed every requirement's internal band (must/should/nice -> essential/standard/
// nice-to-have) and moved the whole app onto AdRequirementsV1. It is meant to be INVISIBLE: the
// deck's cards, the match numbers, the "where you don't fit yet" list and Tailor's questions must
// all read exactly as before. This flow drives the two surfaces the migration touched — the deck
// and Tailor — over a REAL stack (live Fastify API, no route mocks, no LLM) and checks three
// things a unit test cannot:
//
//   1. the displayed copy still says "Essential met" / "Desirable met" (the owner's copy decision
//      was explicitly NOT part of the rename);
//   2. no band token — old vocabulary OR new — has leaked into any text a user can read;
//   3. the served payload really carries the unified vocabulary, and the card's two-bucket
//      essential/desirable rollup agrees with the three-band requirement list underneath it.
//
// Run (ports deliberately non-default — a sibling project on this machine also defaults to :3000,
// and a collision makes one app's frontend silently talk to the other's backend):
//   PORT=3999 node apps/api/dist/main.js
//   API_URL=http://127.0.0.1:3999 npx next dev -p 3998      # from apps/web
//   BASE_URL=http://127.0.0.1:3998 node apps/web/e2e/band-vocabulary-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3998';
const ROLE = 'IT project manager in Hong Kong';
const EMAIL = `band-vocab-${Date.now()}@example.com`;

// Every band token this app has ever used, old and new. None of them may appear in text a user
// reads: the v0 names because they are retired, the v1 names because the rename was internal only.
const RETIRED_BANDS = ['must', 'should', 'nice'];
const INTERNAL_BANDS = ['essential', 'standard', 'nice-to-have'];

const qa = await createSession('band-vocabulary-journey', {
  baseURL: BASE,
  viewport: { width: 430, height: 932 },
});
const { page } = qa;

// Record a pass/fail into the report without aborting, so one defect never costs the evidence for
// every later step. '' is always contained (pass); the sentinel never is (fail).
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// The tailor screen is `fixed inset:0` with its own inner scroller, so window scrolling is a no-op —
// scroll the inner element the way a thumb would, and pause so lazy/scroll-triggered work shows.
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

// Words the user can actually read on the current screen (no aria-labels, no attributes, no markup).
const visibleText = () => page.evaluate(() => document.body.innerText);

// A band token "leaked" only if it appears as a standalone word — advert prose legitimately contains
// "must", "should" and "essential" inside requirement sentences, and flagging those would be noise.
// What must never appear is a bare band label sitting on its own next to a requirement.
function leakedBandLabels(text) {
  const lines = text.split('\n').map((l) => l.trim().toLowerCase().replace(/[.:,]$/, ''));
  return [...RETIRED_BANDS, ...INTERNAL_BANDS].filter((band) => lines.includes(band));
}

// -------------------------------------------------------------------------------------------
// 0. Onboarding: land, establish the anonymous session, seed discovery and sign in over the real
//    magic-link path. Live endpoints, called in-page so the Secure session cookie is carried.
// -------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door');
await qa.scrollThrough('read the landing page the way a first-time visitor would');

await qa.goto('/discovery', 'onboarding: discovery — establishes the anonymous session');
await page.waitForTimeout(700);
await qa.expectVisible('body', 'discovery is up on the live API (no mocks anywhere in this flow)');

await qa.note('start discovery, bring a CV + sign in over the real magic-link path');
await page.evaluate(
  async ({ role }) => {
    await fetch('/api/onboarding/discovery/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  },
  { role: ROLE },
);
// #339: the floor answers that used to give the deck its facts are gone; her read, reviewed CV
// gives them now, so the cards score against real evidence and carry met/unmet lists to read.
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
await qa.note(`her CV was read and reviewed — ${facts} facts on her record`);
const seeded = await page.evaluate(
  async ({ email }) => {
    const post = (url, body) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const res = await post('/api/auth/request-link', { email });
    const link = await res.json();
    // /auth/request-link is rate-limited 5 per 15 min per IP — a 429 silently leaves the session
    // anonymous and every later step fails confusingly, so surface it as itself.
    if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
    const token = new URL('http://x' + link.devLink).searchParams.get('token');
    await post('/api/auth/verify', { token });
    return 'ok';
  },
  { email: EMAIL },
);
if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);
await qa.note('signed in — the deck is now reachable');

// -------------------------------------------------------------------------------------------
// 1. The reveal -> the deck. The first surface the migration touched.
// -------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
// The reveal paints once the deck read settles (her CV's facts are judged first) — wait for it
// rather than asserting into the gap.
await page.getByRole('heading', { name: /matched you/ }).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
await qa.expectVisible(page.getByRole('heading', { name: /matched you/ }), 'the reveal headline');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them — into the card deck');

await qa.expectVisible('.jobdeck', 'DECK: the card deck rendered off v1 requirements');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the score ring');

// -------------------------------------------------------------------------------------------
// 2. THE CENTRAL CHECK — the match breakdown's displayed words are unchanged.
// -------------------------------------------------------------------------------------------
await qa.expectVisible('.breakdown', 'DECK: the match breakdown block');
await qa.expectText('.breakdown', 'Match breakdown', 'the breakdown keeps its heading');
await qa.expectText('.breakdown', 'Requirements met', 'copy unchanged: "Requirements met"');
await qa.expectText('.breakdown', 'Essential met', 'AC5 copy unchanged: the card still says "Essential met"');
await qa.expectText('.breakdown', 'Desirable met', 'AC5 copy unchanged: the card still says "Desirable met"');
await qa.expectText('.breakdown', 'Match quality', 'copy unchanged: "Match quality"');

const breakdownSeen = (await page.locator('.breakdown').innerText()).replace(/\n+/g, ' | ');
await qa.note(`DECK breakdown as a user reads it: ${breakdownSeen}`);

// The screen-reader wording is part of "what the user reads" too — the rename must not have
// reached it either.
const ariaLabels = await page.locator('.breakdown .bd-n').evaluateAll((els) =>
  els.map((e) => e.getAttribute('aria-label')),
);
await qa.note(`DECK breakdown aria-labels: ${JSON.stringify(ariaLabels)}`);
await assert(
  ariaLabels.some((l) => /essential requirements met$/.test(l ?? '')),
  'AC5: the screen-reader label still reads "... essential requirements met"',
);
await assert(
  ariaLabels.some((l) => /desirable requirements met$/.test(l ?? '')),
  'AC5: the screen-reader label still reads "... desirable requirements met"',
);
await assert(
  !ariaLabels.some((l) => /standard|nice-to-have/.test(l ?? '')),
  'AC5: no internal band name ("standard" / "nice-to-have") leaked into a screen-reader label',
);

// -------------------------------------------------------------------------------------------
// 3. The three card lists, including "Where you don't — yet" (the dontYet list, built from the
//    renamed requirements).
// -------------------------------------------------------------------------------------------
await qa.expectVisible(page.getByRole('heading', { name: 'Where you fit' }), 'DECK: "Where you fit"');
await qa.expectVisible(
  page.getByRole('heading', { name: "Where you don't — yet" }),
  'DECK: "Where you don\'t — yet" — the dontYet list the rename runs through',
);
await qa.expectVisible('details.ad', 'DECK: the ad is folded shut, last');
await qa.scrollThrough('read the whole deck card top to bottom, the way a job seeker would');

const dontYetRows = await page.locator('.row.open span:not(.mk)').allInnerTexts();
await qa.note(`DECK "Where you don't — yet" as a user reads it: ${JSON.stringify(dontYetRows)}`);
await assert(
  dontYetRows.every((t) => t.trim().length > 0),
  'every "don\'t yet" row shows the requirement sentence, not a band name or an id',
);

const deckLeaks = leakedBandLabels(await visibleText());
await qa.expectVisible(
  '.jobdeck',
  `DECK: band tokens leaked into visible text: ${deckLeaks.length ? JSON.stringify(deckLeaks) : 'none'}`,
);
await assert(deckLeaks.length === 0, 'AC5/AC6: no requirement band name is readable anywhere on the deck card');

// -------------------------------------------------------------------------------------------
// 4. The payload beneath the pixels — the unified vocabulary really is what the API serves, and
//    the card's two-bucket rollup agrees with the three-band list underneath it.
// -------------------------------------------------------------------------------------------
const served = await page.evaluate(async () => {
  const cards = await (await fetch('/api/onboarding/cards')).json();
  return cards.cards.map((c) => ({
    adId: c.adId,
    matchPct: c.matchPct,
    breakdown: c.breakdown,
    scored: c.scored,
    bands: c.dontYet.map((r) => r.band),
  }));
});
const allBands = [...new Set(served.flatMap((c) => c.bands))];
await qa.note(`API /onboarding/cards — ${served.length} cards; every dontYet band seen: ${JSON.stringify(allBands)}`);
// A card with no honest number carries NO breakdown at all (#117: `unscored` — the spend cap never
// bought it — and `pending`), and that is the product being honest, not a gap in the payload. Read
// straight through it and this line crashes on `null.essential`, which is exactly what it did the
// first time a judge was wired into the QA stack (#209).
//
// Filtering alone would WEAKEN this gate — a deck that quietly stopped carrying breakdowns would
// pass with an empty set. So the missing ones are pinned to the only two states allowed to lack a
// number, which makes the check stricter than the version that crashed: a `judged` or `estimated`
// card with no breakdown is now a failure, and it was previously only a TypeError.
const withBreakdown = served.filter((c) => c.breakdown);
const missingBreakdown = served.filter((c) => !c.breakdown);
await assert(
  missingBreakdown.every((c) => c.scored === 'pending' || c.scored === 'unscored'),
  `only a card claiming no number may lack a breakdown — offenders: ${JSON.stringify(missingBreakdown.map((c) => [c.adId, c.scored]))}`,
);
await assert(
  withBreakdown.every((c) => c.scored === 'judged' || c.scored === 'estimated'),
  `every card carrying a breakdown claims a real number — offenders: ${JSON.stringify(withBreakdown.map((c) => c.scored).filter((v) => v !== 'judged' && v !== 'estimated'))}`,
);
await qa.note(
  `API match numbers (${withBreakdown.length} of ${served.length} cards carry a breakdown; the rest ` +
    `claim no number, so they carry none): ${withBreakdown
      .map((c) => `${c.matchPct}% (E ${c.breakdown.essential.met}/${c.breakdown.essential.total}, D ${c.breakdown.desirable.met}/${c.breakdown.desirable.total})`)
      .join(' · ')}`,
);
await assert(
  allBands.every((b) => INTERNAL_BANDS.includes(b)),
  `AC3: every band the API serves is the unified vocabulary (${JSON.stringify(allBands)})`,
);
await assert(
  !allBands.some((b) => RETIRED_BANDS.includes(b)),
  'AC3: no retired v0 band name (must/should/nice) survives in the served payload',
);
await assert(
  withBreakdown.every((c) => c.breakdown.essential.met <= c.breakdown.essential.total && c.breakdown.desirable.met <= c.breakdown.desirable.total),
  'every card\'s met count is within its total — the rollup is internally consistent',
);
await assert(
  withBreakdown.length > 0
    && withBreakdown.every((c) => c.breakdown.essential.total + c.breakdown.desirable.total > 0),
  'every card that carries a number scores against a non-empty requirement list (the fail-closed pin holds in the live app)',
);

// -------------------------------------------------------------------------------------------
// 5. Swipe through the deck — every card re-renders with the same copy, not just the first.
// -------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'Not for me, show next job' }), 'DECK: swipe left — next job');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the next card rendered');
await qa.expectText('.breakdown', 'Essential met', 'AC5: card two says "Essential met" too');
await qa.expectText('.breakdown', 'Desirable met', 'AC5: card two says "Desirable met" too');
await qa.scrollThrough('read the second card through');
const deckLeaks2 = leakedBandLabels(await visibleText());
await assert(deckLeaks2.length === 0, `no band token leaked on card two either (${JSON.stringify(deckLeaks2)})`);

// -------------------------------------------------------------------------------------------
// 6. Swipe right into Tailor — the second surface the migration touched.
// -------------------------------------------------------------------------------------------
await qa.click(
  page.getByRole('button', { name: 'I want this one, tailor this job' }),
  'DECK: swipe right — I want this one',
);
await page.waitForURL('**/tailor', { timeout: 15_000 });
await qa.expectVisible('.jobdeck.tailor', 'TAILOR: the handoff landed on /tailor');
await page.waitForTimeout(800);

await qa.expectVisible('.tailor .live-card h2', 'TAILOR: the job title heads the live card');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'TAILOR: the score ring');
await qa.expectVisible('.tailor .q', 'TAILOR: question one — derived from the v1 requirement list');
await qa.expectText('.breakdown', 'Essential met', 'AC5: Tailor\'s card says "Essential met", same as the deck');
await qa.expectText('.breakdown', 'Desirable met', 'AC5: Tailor\'s card says "Desirable met", same as the deck');
await readThrough('.live-wrap', 'read Tailor\'s whole live card and the CV paper below it');

// -------------------------------------------------------------------------------------------
// 7. Tailor's questions — the phrasing and the order come off the requirement list the rename
//    touched. Walk several and record every one verbatim.
// -------------------------------------------------------------------------------------------
const questionsAsked = [];
for (let i = 0; i < 4 && (await page.locator('.tailor .opts .opt').count()) > 0; i++) {
  const q = (await page.locator('.tailor .q').textContent()).trim();
  questionsAsked.push(q);
  await qa.expectText('.tailor .q', 'This job wants:', `TAILOR question ${i + 1} keeps the template wording`);
  await qa.note(`TAILOR question ${i + 1}: ${q}`);
  const leaks = leakedBandLabels(await visibleText());
  await assert(leaks.length === 0, `TAILOR question ${i + 1}: no band token readable on screen (${JSON.stringify(leaks)})`);
  await qa.click(page.getByRole('button', { name: 'Yes', exact: true }), `answer "Yes" to question ${i + 1}`);
  await page.waitForTimeout(1200); // let the score tween + row flash play out
}
await qa.note(`TAILOR asked ${questionsAsked.length} questions, in order: ${JSON.stringify(questionsAsked)}`);
await assert(
  questionsAsked.every((q) => /^This job wants: ".+\." Does that describe you\?$/.test(q)),
  'AC6: every Tailor question is the unchanged template over the requirement\'s own sentence',
);
await assert(
  new Set(questionsAsked).size === questionsAsked.length,
  'AC6: no question is repeated — the requirement ids survived the migration intact',
);

await qa.expectText('.tailor .ledger', '+', 'TAILOR: the ledger still names the gain (band weights survived the re-key)');
await qa.note(`TAILOR ledger: "${await page.locator('.tailor .ledger').textContent()}"`);
await readThrough('.live-wrap', 'read the tailored CV — the answers should be on it');

const tailorLeaks = leakedBandLabels(await visibleText());
await qa.expectVisible(
  '.tailor',
  `TAILOR: band tokens leaked into visible text: ${tailorLeaks.length ? JSON.stringify(tailorLeaks) : 'none'}`,
);
await assert(tailorLeaks.length === 0, 'AC5/AC6: no requirement band name is readable anywhere in Tailor');

// -------------------------------------------------------------------------------------------
// 8. Tailor's own payload — the same unified vocabulary, and a fresh reload is stable.
// -------------------------------------------------------------------------------------------
const tailorState = await page.evaluate(async () => {
  const s = await (await fetch('/api/onboarding/tailor')).json();
  return {
    matchPct: s.card.matchPct,
    breakdown: s.card.breakdown,
    bands: s.card.dontYet.map((r) => r.band),
    questions: s.questions.map((q) => q.requirementId),
  };
});
await qa.note(
  `API /onboarding/tailor — ${tailorState.matchPct}% · bands ${JSON.stringify([...new Set(tailorState.bands)])} · next question ids ${JSON.stringify(tailorState.questions.slice(0, 3))}`,
);
await assert(
  tailorState.bands.every((b) => INTERNAL_BANDS.includes(b)),
  `AC3: Tailor's payload speaks the unified vocabulary too (${JSON.stringify([...new Set(tailorState.bands)])})`,
);

await qa.goto('/tailor', 'reload Tailor — the migrated state must survive a fresh read');
await page.waitForTimeout(900);
await qa.expectVisible('.tailor .live-card', 'TAILOR: the card re-rendered after a reload');
await qa.expectText('.breakdown', 'Essential met', 'AC5: still "Essential met" after a reload');
await qa.scrollThrough('final read-through of the reloaded card');
const reloadLeaks = leakedBandLabels(await visibleText());
await assert(reloadLeaks.length === 0, `no band token after a reload either (${JSON.stringify(reloadLeaks)})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
