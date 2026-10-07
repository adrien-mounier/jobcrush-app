// #216 (over #234's split, spec #233 decision 1) — the visitor's own interview is the one the
// reveal is gated on.
//
// #234 SPLIT the stored fact; #216 closed the gap underneath it. Until #216 the product asked one
// question set and gated the reveal on another: the shipped screen drove /onboarding/discovery/*,
// which never wrote `session.discovery`, while a parallel /onboarding/discovery/production/*
// interview — the only writer — had no client at all. A visitor could answer every question
// truthfully and still reach the deck with `{ family: null, checkpoint: null }`. The production
// surface is gone; the shipped routes reconcile. This journey walks the funnel a person walks and
// then reads the durable record her OWN answers produced.
//
// #234's original claim, kept below: the split itself must change nothing she can see.
//
// One stored fact used to do two jobs: it selected the family floor whose essential items discovery
// asks, AND named the family retrieval searches with. #234 splits it into `questionFloors` (a list)
// and `searchFamily` (one or none), and adds `discoveryPlan()` as the one function that decides
// both. For a mapped target role — every visitor who reaches anything today — both hold the same
// family, so the ticket's own proof is that nothing moves.
//
// That is exactly the kind of change a unit suite cannot vouch for. The record this reshapes is read
// by the deck's scoring (the advert-family scope for the years bars) and by posting retrieval, so a
// silent regression shows up as a changed or blank deck, not as a red test. So this journey drives
// the whole shipped funnel in a browser and then reads the record back off the visitor's own
// session — never through a second interview surface, because there is no longer one.
//
// It is also the guard against the OPPOSITE failure. #235's word search must keep serving the
// visitor no published family covers: she is never refused, nothing is pinned for her, and no
// error surface reaches her screen. If that stops being true, this journey goes red.
//
// Run it:
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30234
//   BASE_URL=http://127.0.0.1:30234 node apps/web/e2e/discovery-plan-split-journey.mjs
//
// Ports are deliberately not 3000/3001: another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time. Run serially — the run mints anonymous sessions and one magic-link sign-in, both capped
// per IP.

import { createSession } from './qa-driver.mjs';
import { request } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30234';
// A role the published vocabulary covers — the mapped case, i.e. every visitor today.
const ROLE = 'IT project manager';
// A role it does not cover. #235 gives her a word search — never a refusal.
const UNMAPPED_ROLE = 'sous vide pastry chef';
const AREA = 'Singapore';
const FAMILY = 'it-project-delivery';

const CV_TEXT = [
  'Marta Kowalska',
  'marta.kowalska@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2018 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2013 - Feb 2018',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2013',
].join('\n');

const qa = await createSession('discovery-plan-split-journey', {
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

// Ask the API the way this visitor's own browser would — same cookie, same server.
async function callAsVisitor(method, path, data) {
  const res = await page.request.fetch(`${BASE}/api${path}`, { method, ...(data ? { data } : {}) });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* a non-JSON body is itself the finding */ }
  return { status: res.status(), body, json: parsed };
}
const json = async (path) => (await callAsVisitor('GET', path)).json;

// =============================================================================================
// 1. The whole shipped funnel, in a browser, exactly as a person walks it.
// =============================================================================================
// #271: the CV goes in first, through the front door's paste tile — the order a person walks
// (the deleted /paste side entrance used to let these steps run backwards).
await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes a CV with two dated jobs and one degree');
await qa.completeReview(); // #338: a brought CV is reviewed before any job is shown (ADR-0016 clause 6)
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', ROLE, `the role this visitor is going for: "${ROLE}"`);
await qa.fill('#search-area', AREA, 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'save what I want next — this is what places the session into a family');
await page.waitForTimeout(1200);
const intent = await json('/sessions/me/intent');
await assertTrue(
  intent?.intent?.targetRole === ROLE,
  `the front door recorded the target role (${JSON.stringify(intent?.intent?.targetRole)}) — the only input that places a session into a family`,
);

let blocks = [];
for (let i = 0; i < 60; i += 1) {
  const b = await json('/job-blocks');
  if (b?.blocks?.length) { blocks = b.blocks; break; }
  await page.waitForTimeout(500);
}
await qa.note(
  `the product read ${blocks.length} dated records:\n` +
  blocks.map((b) => `  - ${b.employer.value} (${b.kind}, counts: ${b.countsTowardExperience}) -> ${
    b.family?.value?.outcome ?? 'not labeled'
  }`).join('\n'),
);
await assertTrue(blocks.length === 3, 'three dated records landed, one of them education');

await qa.goto('/discovery', 'into discovery — the sign-up questions');
// #322: the front door already took the role, so discovery opens on the checklist - no question 1.
await page.waitForTimeout(2500);
await qa.scrollThrough('read the discovery screen the way a real visitor would');

// Answer every floor question the screen actually puts to her. The ids are READ OFF the state, not
// hard-coded: the whole point of #216 is that these come from her placed family's published floor,
// so a hard-coded list would be asserting yesterday's question set (it did — this journey carried
// the retired stub's ids until #216).
const asked = [];
for (let i = 0; i < 12; i += 1) {
  const state = await json('/onboarding/discovery');
  const ask = (state?.questions ?? []).find((q) => !q.eligibility);
  if (!ask) break;
  const option = (ask.options ?? []).find((o) => !/^no[.!]?$/i.test(o.trim())) ?? 'Yes';
  asked.push(ask.itemId);
  await callAsVisitor('POST', '/onboarding/discovery/answer', { itemId: ask.itemId, answer: option });
}
await qa.note(`the questions her own screen put to her, in order: ${asked.join(', ') || '(none)'}`);
await assertTrue(
  asked.length >= 4,
  `AC1 — the shipped screen asked her the published family floor, not a stub (${asked.length} items: ${asked.join(', ')})`,
);
await qa.goto('/discovery', 'back to discovery — her answers are in');
await qa.scrollThrough('read the answered discovery screen');

await qa.goto('/deck', 'the reveal');
await qa.expectVisible('.jobdeck', 'the reveal screen — the deck is behind the sign-in wall (#21)');
await qa.scrollThrough('read the reveal the way a visitor decides whether to sign in');

const signIn = await callAsVisitor('POST', '/auth/request-link', { email: `plan-split-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await callAsVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });

await qa.goto('/deck', 'back to the deck, now past the wall');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: she reached the card deck — the end of the shipped journey');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: a real scored card, not a blank screen');
await qa.scrollThrough('read the first deck card top to bottom, the way a job seeker would');

// The deck as it stands BEFORE anything touches the discovery record. Everything below has to leave
// this untouched — that is the whole claim of the ticket.
//
// #338 (CI runs 37459528860, 37471254079, 37480981918 — three for three on the shared runner, never
// locally, where both reads give 49%): the "before" read came back 59% on every card and the "after"
// read 49%, so the order moved. The score a card shows is recomputed at every read from the facts the
// background labelers write a few seconds after the CV read (family and industry placements, then
// the per-scope years facts — deck.ts resolveSessionYears, judgedScore.ts answerIndustryBar), and on
// the slow runner that landing falls between this journey's two reads. Waiting for the placements
// alone (c5d0cd4) was not enough — the years facts land after the placement, and a read can fall in
// between. So both snapshots now wait for a SETTLED deck: every counting job placed, no card still
// pending or estimated, and three consecutive reads a second apart identical. The two decks compared
// then differ only by what the discovery record did.
const settledDeck = async (what) => {
  let last = null;
  let same = 0;
  let cards = [];
  let blocks = [];
  let placed = false;
  let rounds = 0;
  for (let i = 0; i < 45; i += 1) {
    rounds = i + 1;
    blocks = (await json('/job-blocks'))?.blocks ?? []; // also kicks the labelers' retry
    placed = blocks.length > 0 && blocks
      .filter((b) => b.countsTowardExperience)
      .every((b) => b.family?.value != null && b.industry?.value != null);
    cards = (await json('/onboarding/cards'))?.cards ?? [];
    const unfinished = cards.filter((c) => c.scored === 'pending' || c.scored === 'estimated').length;
    const fingerprint = JSON.stringify(cards.map((c) => [c.adId, c.matchPct, c.scored]));
    same = fingerprint === last ? same + 1 : 0;
    last = fingerprint;
    if (placed && cards.length > 0 && unfinished === 0 && same >= 2) break;
    await page.waitForTimeout(1000);
  }
  const provenance = cards.reduce((acc, c) => ({ ...acc, [c.scored]: (acc[c.scored] ?? 0) + 1 }), {});
  await qa.note(`${what}: ${cards.length} cards — ${cards.map((c) => `${c.adId}=${c.matchPct}%`).slice(0, 4).join(', ')}${cards.length > 4 ? ', …' : ''} (scored: ${JSON.stringify(provenance)}; settled after ${same} identical re-reads)`);
  // Diagnostics for the next time the two reads differ: what the score was built from, and whether
  // the wait ended because the deck settled or because it ran out of rounds.
  const me = await json('/sessions/me');
  const placements = blocks.map((b) => `${b.employer?.value}: counts=${b.countsTowardExperience} family=${b.family?.value?.outcome ?? 'none'} industry=${b.industry?.value?.outcome ?? 'none'}`);
  await qa.note(`${what} — after ${rounds} rounds, placed=${placed}; searchFamily=${JSON.stringify(me?.discovery?.searchFamily)}; blocks: ${placements.join(' | ')}; first card breakdown=${JSON.stringify(cards[0]?.breakdown)}, dontYet=${JSON.stringify((cards[0]?.dontYet ?? []).map((d) => d.id))}`);
  return cards;
};
const deckBefore = await settledDeck('the deck she reached');
await assertTrue(deckBefore.length > 0, 'the deck is not empty — she has cards to act on');

// =============================================================================================
// 2. The record HER OWN answers wrote. This is #216: one engine, and the interview she walked is
//    the one the reveal is gated on. Read straight off her session — there is no second surface
//    to walk any more, and the assertions below would all have been null before this ticket.
// =============================================================================================
await qa.note(`AC1/AC2/AC6 — reading the discovery record this visitor's own answers produced`);

const pinned = (await json('/sessions/me'))?.discovery;
await qa.note(`the stored discovery record: ${JSON.stringify(pinned)}`);
await assertTrue(
  Array.isArray(pinned?.questionFloors) && pinned.questionFloors.length === 1 &&
    pinned.questionFloors[0].familyId === FAMILY && pinned.questionFloors[0].version === 2,
  `AC1 — the questions she was asked came from her placed family's published floor, pinned to her session`,
);
await assertTrue(
  pinned?.searchFamily?.familyId === FAMILY && pinned?.searchFamily?.version === 2,
  'AC1/AC5 — the search family is a SEPARATE fact, and for a mapped role it is the same family',
);
await assertTrue(
  !('floor' in (pinned ?? {})),
  '#234 — the single fact that did both jobs is gone from the record outright; no old key is kept alongside',
);
await assertTrue(
  pinned?.checkpoint === 'essential_floor_covered',
  `AC2 — answering the questions on her own screen is what earned the checkpoint (${pinned?.checkpoint})`,
);
await assertTrue(
  Array.isArray(pinned?.coveredItemIds) && asked.every((id) => pinned.coveredItemIds.includes(id)),
  `AC2 — every item she answered is recorded against her session (${JSON.stringify(pinned?.coveredItemIds)})`,
);

// AC6 — ONE engine. The parallel interview is gone from the server, not merely unused by the client.
for (const [method, path] of [
  ['GET', '/onboarding/discovery/production'],
  ['POST', '/onboarding/discovery/production/evaluate'],
  ['POST', '/onboarding/discovery/production/answer'],
  ['POST', '/onboarding/discovery/production/complete'],
]) {
  const gone = await callAsVisitor(method, path, method === 'POST' ? {} : undefined);
  await assertTrue(
    gone.status === 404,
    `AC6: ${method} ${path} no longer exists — one discovery engine remains (${gone.status})`,
  );
}

// The pin holds under a re-entry: re-deriving the same plan reconciles coverage, it never moves the
// plan and never errors on her own screen.
await qa.goto('/discovery', 'she re-enters discovery, the way anyone reloads a page');
await page.waitForTimeout(1500);
const afterReentry = (await json('/sessions/me'))?.discovery;
await assertTrue(
  JSON.stringify(afterReentry?.questionFloors) === JSON.stringify(pinned?.questionFloors) &&
    JSON.stringify(afterReentry?.searchFamily) === JSON.stringify(pinned?.searchFamily) &&
    afterReentry?.checkpoint === 'essential_floor_covered',
  'once pinned, the plan does not change under the session, and re-reading does not lose the checkpoint',
);

// A correction: she changes one answer to a plain "No". #235 (spec #233 decision 6) decided that an
// explicit "no" is a real ANSWER, not a gap — it closes the item and the checkpoint holds. Recorded
// here because #216's own acceptance text, written before that decision, says the opposite.
const correctedItem = asked[0];
await callAsVisitor('POST', '/onboarding/discovery/answer', { itemId: correctedItem, answer: 'No' });
const afterCorrection = (await json('/sessions/me'))?.discovery;
await assertTrue(
  afterCorrection?.coveredItemIds?.includes(correctedItem) &&
    afterCorrection?.checkpoint === 'essential_floor_covered',
  `correcting "${correctedItem}" to a plain "No" keeps it covered — an honest no is an answer, not a hole (${afterCorrection?.checkpoint})`,
);

// =============================================================================================
// 3. Her deck is untouched. THE claim of the ticket, checked on the screen and not only on the wire.
// =============================================================================================
await qa.goto('/deck', 'back to her deck after all of that');
const seeAgain = page.getByRole('button', { name: 'See them' });
if (await seeAgain.count()) await qa.click(seeAgain.first(), 'See them — into the card deck again');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: still a deck, not a blank screen');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: still a scored card');
await qa.scrollThrough('read the deck again, looking for anything that moved');

const deckAfter = await settledDeck('the deck now');
await assertTrue(
  deckAfter.length === deckBefore.length,
  `the deck has the same number of cards as before discovery pinned anything (${deckBefore.length} -> ${deckAfter.length})`,
);
await assertTrue(
  JSON.stringify(deckAfter.map((c) => c.adId)) === JSON.stringify(deckBefore.map((c) => c.adId)),
  'the deck is in the same order — the advert-family scope the score rings ride on still resolves',
);

// Nothing user-facing was added. #235/#236 own the visible half; if any of their words appear here,
// this ticket has grown a scope it was explicitly told not to have (spec #233 decision 8).
const deckText = await page.locator('body').innerText();
const leaked = ['job family', 'family research', 'vocabulary', 'keyword search', 'word search', 'we could not place']
  .filter((phrase) => deckText.toLowerCase().includes(phrase));
await assertTrue(
  leaked.length === 0,
  `no new copy reached the deck screen — nothing tells her which kind of search she got (found: ${leaked.join(', ') || 'nothing'})`,
);

// =============================================================================================
// 4. The visitor no published family covers. #235: she is served, never refused - and #216 must
//    not pin a family for her behind her back.
// =============================================================================================
await qa.note('the unmapped visitor - the word search serves her, and nothing is pinned for her');
const other = await request.newContext({ baseURL: BASE });
const asOther = async (method, path, data) => {
  const res = await other.fetch(`${BASE}/api${path}`, { method, ...(data ? { data } : {}) });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* ignore */ }
  return { status: res.status(), body, json: parsed };
};
await asOther('POST', '/sessions/anonymous');
await asOther('PUT', '/sessions/me/intent', { targetRole: UNMAPPED_ROLE, searchArea: AREA });
await asOther('POST', '/cv/paste', { text: CV_TEXT });

const served = await asOther('POST', '/onboarding/discovery/start', { role: UNMAPPED_ROLE });
await qa.note(`the unmapped visitor's answer, verbatim: HTTP ${served.status} ${served.body.slice(0, 200)}`);
await assertTrue(
  served.status === 200,
  `AC4: an unmapped target role is SERVED, never refused (${served.status} ${served.json?.error?.code ?? ''})`,
);
// #235 (spec #233 decision 3): her CV PROVES a family even though her typed role cannot be placed,
// so she is interviewed on that family's floor and her screen legitimately names it. What must stay
// null is the family she is SEARCHED on - that is the half that would be a reveal she never earned.
await assertTrue(
  (served.json?.questions ?? []).some((q) => !q.eligibility),
  `AC4: she is asked real questions rather than dead-ended - the floors her own CV proves (${(served.json?.questions ?? []).length} on screen)`,
);
const otherRecord = (await asOther('GET', '/sessions/me')).json?.discovery;
await qa.note(`her stored discovery record: ${JSON.stringify(otherRecord)}`);
await assertTrue(
  otherRecord?.searchFamily === null,
  `AC4: no family reveal is authorized for her - retrieval searches her own words (${JSON.stringify(otherRecord?.searchFamily)})`,
);
await assertTrue(
  otherRecord?.checkpoint !== 'essential_floor_covered' || (otherRecord?.questionFloors?.length ?? 0) === 0,
  `AC4: a covered checkpoint is only ever written against floors she was actually asked (${JSON.stringify(otherRecord)})`,
);
await other.dispose();

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
