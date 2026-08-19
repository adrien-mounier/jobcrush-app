// #222 — "years per family, read at the advert's own scope": the whole journey a real person walks.
//
// Paste a CV with dated jobs -> the labeler places one job in a family and leaves one unmapped ->
// discovery -> the deck, where an advert's years bars are supposed to be tested at their OWN scope
// (the family bar against her years in the advert's family, the total bar against her career total).
//
// What this flow is really for: proving on the RUNNING product, not in a seeded test, that the
// family scope is actually resolved for a visitor. deck.ts's advertFamilyIdFor takes the confirmed
// floor when the production checkpoint pinned one, else the TARGET-ROLE placement. The web client
// never walks the production-discovery flow, so on the shipped journey the floor is always null and
// the target-role placement is the ONLY thing that can resolve the scope — this flow is the check
// that it does. (QA finding 1 on the first #222 gate: before the fix, nothing resolved it and the
// whole per-family reading was dead code on the visitor's path, however green the unit tests were.)
//
// The assertion is an A/B the flow runs itself, because a score alone proves nothing:
//   - the BROWSER session types a target role that places into the family. Her time in that family
//     is corrected down to a few months while an unmapped job is stretched back to 1998, so her
//     family years fall far under the advert's "5+ years as a Project Manager" bar while her career
//     total sails over the "8+ years of IT" one. Under a family-scoped reading the card must sink.
//   - a CONTROL session over the wire does the identical thing but types a role that places nowhere,
//     so advertFamilyIdFor returns null and the bar falls back to the career total.
// browser < control proves the family reading fired. Equal would mean it is still reading the total.
//
// Also walks the correction door (AC3: every door that changes a job record re-derives the facts)
// and checks that the confidence ordinal is never printed to the visitor (AC14).
//
// Nothing is stubbed — real Fastify, real extraction, real miner parse, real job-block store, real
// labeler, real Next build. Only the MODEL is faked (apps/api/dist/qa-main.js), so the run is free
// and deterministic.
//
// Run it:
//   node apps/api/dist/qa-main.js                                  # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30222
//   BASE_URL=http://127.0.0.1:30222 node apps/web/e2e/family-years-scope-journey.mjs
//
// Run serially: every run mints an anonymous session and the API caps those per IP per hour.

import { createSession } from './qa-driver.mjs';
import { request } from '@playwright/test';
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30222';
// A role that PLACES into the published family — makeFamilyPlacer reads session.intent.targetRole,
// which the front door sets. The control below deliberately types one that places nowhere.
const ROLE = 'IT project manager';
const UNPLACEABLE_ROLE = 'sous vide pastry chef';
const AREA = 'Singapore';
// The corrections that make the two readings disagree: a few months in the family, a long career.
const FAMILY_START = { year: 2026, month: 1, precision: 'month' };
const CAREER_START = { year: 1998, month: 1, precision: 'month' };
// #216: the floor is READ, not hard-coded. Identical RULE in both arms of the A/B - two positives
// then a "No" - applied to whichever floor each arm is actually served, so the typed role stays the
// only variable between them even though the two arms are placed into different families.
// qa-driver's seedFloorAnswers note records what hard-coding these ids cost the last time.
const answerFloorWith = async (fetchState, post) => {
  const state = await fetchState();
  const ids = (state?.questions ?? []).filter((q) => !q.eligibility).map((q) => q.itemId);
  for (let i = 0; i < ids.length; i += 1) {
    await post({ itemId: ids[i], answer: i === ids.length - 1 ? 'No' : 'Yes, over $1M' });
  }
  return ids;
};
// The motivating advert (spec #219): "8+ years of IT experience including 5+ years as a Project
// Manager" — since #222 that is TWO scoped bars, total >= 8 and family >= 5.
// #63: the card carries the id retrieval delivered, not the pool's own key - see live-ad-id.mjs.
const COMPOUND_AD = liveAdId('2026-07-05_endava-vietnam_senior-project-manager');

const CV_TEXT = [
  'Jane Doe',
  'jane.doe@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

const qa = await createSession('family-years-scope-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

// A hard assertion the driver records with a screenshot either way.
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const api = (method, path, data) => page.request.fetch(`${BASE}/api${path}`, { method, data });
const json = async (path) => (await api('GET', path)).json();

// ---------------------------------------------------------------------------------------------
// 1. The front door, then the CV a real person pastes in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');

// State the target role. This is the ONLY thing that resolves the advert's family on the shipped
// journey (makeFamilyPlacer reads session.intent.targetRole), so it is load-bearing, not setup.
const ready = page.getByRole('button', { name: /Ready\?/ });
if (await ready.count()) await qa.click(ready.first(), 'open the front door');
const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
if (await startQuestions.count()) await qa.click(startQuestions.first(), 'choose to start from questions');
if (await page.locator('#target-role').count()) {
  await qa.fill('#target-role', ROLE, `the role this visitor is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, 'where they want to work');
  await qa.click('button:has-text("Save and continue")', 'save what I want next — this is what places the session into a family');
  await page.waitForTimeout(1200);
}
const intentAfter = await (await api('GET', '/sessions/me/intent')).json();
await qa.note(`the front door recorded targetRole = ${JSON.stringify(intentAfter?.intent?.targetRole)}`);
await assertTrue(
  !!intentAfter?.intent?.targetRole,
  'the target role is on the session — the only input that can resolve the advert family on the shipped journey',
);

await qa.goto('/paste', 'paste a CV with two dated jobs and one degree');
await qa.fill('textarea', CV_TEXT, 'the dated work history every years number below is worked out from');
await qa.click('button.btn', 'send the CV to be read');
await page.waitForTimeout(2000);

// ---------------------------------------------------------------------------------------------
// 2. The labeler is a door that changes a job record — it must leave per-family facts behind (AC3).
// ---------------------------------------------------------------------------------------------
let blocks = [];
for (let i = 0; i < 60; i++) {
  const r = await api('GET', '/job-blocks');
  if (r.ok()) { const j = await r.json(); if ((j.blocks ?? []).length) { blocks = j.blocks; break; } }
  await page.waitForTimeout(500);
}
await qa.note(
  `the product read ${blocks.length} dated records:\n` +
  blocks.map((b) => `  - ${b.employer.value} (${b.kind}, counts: ${b.countsTowardExperience}) -> ${
    b.family?.value ? `${b.family.value.outcome}${b.family.value.families ? ' ' + b.family.value.families.map((f) => f.familyId).join('+') : ''}` : 'not labeled'
  }`).join('\n'),
);
await assertTrue(blocks.length === 3, 'three dated records landed, one of them education');

const placedBlock = blocks.find((b) => b.family?.value?.outcome === 'confirmed');
const unmappedBlock = blocks.find((b) => b.family?.value?.outcome === 'unmapped');
await assertTrue(!!placedBlock, 'AC1/AC3 — the labeler placed a dated job into a family, so a per-family years fact exists');
await assertTrue(!!unmappedBlock, 'AC5 — one job is unmapped: it counts toward the total and toward no family number');

// ---------------------------------------------------------------------------------------------
// 2b. Make the two readings disagree, through the product's OWN correction door (the UI has no
//     affordance for editing a date, so this goes through the endpoint the review screen uses, on
//     the browser's own session cookie — never past it). A few months in the family, a long career
//     outside it: her family years fall far under the advert's "5+ years as a PM" bar while her
//     career total sails over the "8+ years of IT" one.
// ---------------------------------------------------------------------------------------------
await qa.note(
  `correcting "${placedBlock?.employer.value}" (in the family) to start ${FAMILY_START.year} and ` +
  `"${unmappedBlock?.employer.value}" (unmapped, counts to the total only) to start ${CAREER_START.year}`,
);
for (const [blk, start] of [[placedBlock, FAMILY_START], [unmappedBlock, CAREER_START]]) {
  if (!blk) continue;
  const r = await api('POST', `/job-blocks/${blk.id}/correct`, { key: 'start', value: start });
  await assertTrue(r.ok(), `AC3 — the correction door accepted the new start date for "${blk.employer.value}"`);
}

// ---------------------------------------------------------------------------------------------
// 3. Discovery, then the deck — the surface where the scoped reading is supposed to happen.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery — the sign-up questions');
await qa.fill('#q1-role', ROLE, 'the role this visitor is going for');
await qa.click('button.go.wide', 'answer the role question');
await page.waitForTimeout(2500);
await qa.scrollThrough('read the discovery screen the way a real visitor would');

// Answer the discovery floor over the product's own endpoint, on the browser's own session cookie.
// These exact three answers are replayed verbatim by the CONTROL visitor below: the A/B is only
// worth anything if the fact set is identical in both arms and the typed ROLE is the sole variable.
// (Prior art: band-vocabulary-journey seeds discovery the same way.)
const answeredFloor = await answerFloorWith(
  () => json('/onboarding/discovery'),
  (body) => api('POST', '/onboarding/discovery/answer', body),
);
await assertTrue(
  answeredFloor.length > 0,
  `the placed arm was served a real family floor to answer (${answeredFloor.join(', ') || 'nothing'})`,
);
await qa.note(`answered the discovery floor her placed family asks: ${answeredFloor.join(', ')}`);
await qa.goto('/discovery', 'back to discovery — the answers are in');
await qa.scrollThrough('read the answered discovery screen');

await qa.goto('/deck', 'the reveal');
await qa.expectVisible('.jobdeck', 'the reveal screen — the deck is behind the sign-in wall (#21)');
await qa.scrollThrough('read the reveal the way a visitor decides whether to sign in');

// Sign in over the real magic-link path — the deck's cards only render past the wall.
const signIn = await api('POST', '/auth/request-link', { email: `family-years-${Date.now()}@example.com` });
const devLink = (await signIn.json()).devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
if (devLink) {
  await api('POST', '/auth/verify', { token: new URL('http://x' + devLink).searchParams.get('token') });
  await qa.note('signed in — the cards are now reachable');
}

await qa.goto('/deck', 'back to the deck, now past the wall');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: the card deck rendered');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the score ring — the number this whole ticket moves');
await qa.scrollThrough('read the first deck card top to bottom, the way a job seeker would');

// ---------------------------------------------------------------------------------------------
// 4. AC14 — the confidence level is a ranking input, never a fact shown to the person.
// ---------------------------------------------------------------------------------------------
const deckText = await page.locator('body').innerText();
await assertTrue(
  !/\b(certain|likely|possible)\b/i.test(deckText),
  'AC14 — no confidence level ("certain"/"likely"/"possible") is printed anywhere on the deck screen',
);
const cardsWire = JSON.stringify(await json('/onboarding/cards'));
await assertTrue(
  !/"confidence"|"certain"|"likely"|"possible"/.test(cardsWire),
  'AC14 — the deck payload the browser receives carries no confidence level either',
);

// ---------------------------------------------------------------------------------------------
// 5. AC7 — no surface sums the per-family numbers into one figure.
// ---------------------------------------------------------------------------------------------
await assertTrue(
  !/years? (of experience )?(in total|combined|across)/i.test(deckText),
  'AC7 — no screen presents a summed-families figure',
);

// ---------------------------------------------------------------------------------------------
// 6. THE HEADLINE (QA finding 1): is the advert's family scope actually resolved for a visitor?
//
//    No production-discovery route was called anywhere above, so the floor is null — that is the
//    shipped journey, and it must NOT be what decides this any more. advertFamilyIdFor should fall
//    through to the target-role placement. The A/B below is what proves it did.
// ---------------------------------------------------------------------------------------------
const me = await json('/sessions/me');
await qa.note(
  `session.discovery.searchFamily: ${JSON.stringify(me.discovery?.searchFamily)} — null, as on every shipped ` +
  'journey (no production-discovery route is reachable from the web client). The scope must come ' +
  'from the target-role placement instead.',
);

const compound = (await json('/onboarding/cards')).cards?.find((c) => c.adId === COMPOUND_AD);
await qa.note(
  compound
    ? `the compound advert ("8+ years of IT including 5+ as a PM") scores ${compound.matchPct}% for this visitor`
    : 'the compound advert is not in this visitor\'s deck',
);

// The CONTROL: an identical visitor — same CV, same corrections, same advert — whose typed role
// places into NO family, so advertFamilyIdFor returns null and the family bar falls back to the
// career total. Run over the wire with its own cookie jar so it cannot disturb the browser session.
const ctl = await request.newContext({ baseURL: BASE });
const cjson = async (path, method = 'GET', data) =>
  (await ctl.fetch(`${BASE}/api${path}`, { method, ...(data ? { data } : {}) })).json();
await ctl.fetch(`${BASE}/api/sessions/anonymous`, { method: 'POST' });
await cjson('/sessions/me/intent', 'PUT', { targetRole: UNPLACEABLE_ROLE, searchArea: AREA });
await cjson('/cv/paste', 'POST', { text: CV_TEXT });
let ctlBlocks = [];
for (let i = 0; i < 60; i++) {
  const b = await cjson('/job-blocks');
  if (b?.blocks?.length) { ctlBlocks = b.blocks; break; }
  await page.waitForTimeout(500);
}
const ctlPlaced = ctlBlocks.find((b) => b.family?.value?.outcome === 'confirmed');
const ctlUnmapped = ctlBlocks.find((b) => b.family?.value?.outcome === 'unmapped');
if (ctlPlaced) await cjson(`/job-blocks/${ctlPlaced.id}/correct`, 'POST', { key: 'start', value: FAMILY_START });
if (ctlUnmapped) await cjson(`/job-blocks/${ctlUnmapped.id}/correct`, 'POST', { key: 'start', value: CAREER_START });
await cjson('/onboarding/discovery/start', 'POST', { role: UNPLACEABLE_ROLE });
await answerFloorWith(
  () => cjson('/onboarding/discovery'),
  (body) => cjson('/onboarding/discovery/answer', 'POST', body),
);
const ctlCard = (await cjson('/onboarding/cards')).cards?.find((c) => c.adId === COMPOUND_AD);
await ctl.dispose();

await qa.note(
  `A/B — this visitor typed "${ROLE}" and scores ${compound?.matchPct}%; an otherwise identical ` +
  `visitor who typed "${UNPLACEABLE_ROLE}" (places nowhere, so the bar falls back to her career ` +
  `total) scores ${ctlCard?.matchPct}%.`,
);
await assertTrue(
  typeof compound?.matchPct === 'number' &&
    typeof ctlCard?.matchPct === 'number' &&
    compound.matchPct < ctlCard.matchPct,
  'AC4/AC13 (QA finding 1) — the family-scoped reading is LIVE on the shipped journey: the advert\'s ' +
    'years bar is tested against her years in THAT family, not her career total',
);
await assertTrue(
  typeof ctlCard?.matchPct === 'number',
  'AC6 — a visitor whose role places into no family still gets a scored card: the career-total fallback holds, nothing is withdrawn',
);

// ---------------------------------------------------------------------------------------------
// 7. AC3 — a label correction is a door too: the per-family facts must re-derive through it, and
//    the card must move when they do.
// ---------------------------------------------------------------------------------------------
if (unmappedBlock) {
  const before = compound?.matchPct ?? null;
  await qa.note(`correcting the unmapped job ("${unmappedBlock.employer.value}") into the published family`);
  const corrected = await api('POST', `/job-blocks/${unmappedBlock.id}/correct`, {
    key: 'family',
    value: { familyId: 'it-project-delivery', version: 1 },
  });
  await assertTrue(corrected.ok(), 'AC3 — the correction door accepted the new family placement');
  const body = corrected.ok() ? await corrected.json() : {};
  await qa.note(`the product told the person: "${body.downstream ?? '(nothing)'}"`);

  const after = (await json('/onboarding/cards')).cards?.find((c) => c.adId === COMPOUND_AD);
  await qa.note(
    `compound advert after the correction: ${after?.matchPct}% (was ${before}%) — her 28 years now ` +
    'count INSIDE the advert\'s family, so the family bar it was failing is met',
  );
  await assertTrue(
    typeof after?.matchPct === 'number' && typeof before === 'number' && after.matchPct > before,
    'AC3 — correcting the unmapped job into the family re-derived the per-family fact AND moved the card',
  );
  await qa.goto('/deck', 'back to the deck after the correction');
  const seeAgain = page.getByRole('button', { name: 'See them' });
  if (await seeAgain.count()) await qa.click(seeAgain.first(), 'back into the card deck');
  await page.waitForTimeout(1500);
  await qa.scrollThrough('read the re-scored deck the way the visitor would after fixing their history');
  await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the card still scores and is still there — nothing was withdrawn');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
