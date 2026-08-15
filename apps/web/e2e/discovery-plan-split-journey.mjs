// #234 (spec #233 decision 1, decided in #230) — the prefactor that must change NOTHING a visitor
// can see.
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
// the whole shipped funnel in a browser and then, from inside that same visitor's session, walks the
// production-discovery route the split rewrote — including the refusal codes whose CONDITIONS were
// rewritten (`production_discovery_not_started` and `production_floor_already_pinned` had, and still
// have, no unit coverage at all: measured 2026-08-15, they appear nowhere outside onboarding.ts).
//
// It is also the guard against the OPPOSITE failure. #235 opens the word search and #236 wires the
// background family-candidate screen; until they land, an unmapped visitor must still be refused
// with the identical `placement_not_confirmed` body and offered the family-research path. If that
// stops being true before those tickets ship, this journey goes red — which is the point.
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
// A role it does not cover. #235/#236 give her a word search; until then she must be refused exactly
// as she is on main.
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
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');

const ready = page.getByRole('button', { name: /Ready\?/ });
if (await ready.count()) await qa.click(ready.first(), 'open the front door');
const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
if (await startQuestions.count()) await qa.click(startQuestions.first(), 'choose to start from questions');
if (await page.locator('#target-role').count()) {
  await qa.fill('#target-role', ROLE, `the role this visitor is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'save what I want next — this is what places the session into a family');
  await page.waitForTimeout(1200);
}
const intent = await json('/sessions/me/intent');
await assertTrue(
  intent?.intent?.targetRole === ROLE,
  `the front door recorded the target role (${JSON.stringify(intent?.intent?.targetRole)}) — the only input that places a session into a family`,
);

await qa.goto('/paste', 'paste a CV with two dated jobs and one degree');
await qa.fill('textarea', CV_TEXT, 'the work history the deck will judge her against');
await qa.click('button.btn', 'send the CV to be read');
await page.waitForTimeout(2000);

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
await qa.fill('#q1-role', ROLE, 'the role she is going for');
await qa.click('button.go.wide', 'answer the role question');
await page.waitForTimeout(2500);
await qa.scrollThrough('read the discovery screen the way a real visitor would');

for (const a of [
  { itemId: 'budget-accountability', answer: 'Yes, over $1M' },
  { itemId: 'cross-functional-leadership', answer: 'Yes, multiple teams' },
  { itemId: 'stakeholder-reporting', answer: 'Yes, monthly to the steering group' },
]) {
  await callAsVisitor('POST', '/onboarding/discovery/answer', a);
}
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
const deckBefore = (await json('/onboarding/cards'))?.cards ?? [];
const scoresBefore = deckBefore.map((c) => `${c.adId}=${c.matchPct}%`);
await qa.note(`the deck she reached: ${deckBefore.length} cards — ${scoresBefore.slice(0, 4).join(', ')}${deckBefore.length > 4 ? ', …' : ''}`);
await assertTrue(deckBefore.length > 0, 'the deck is not empty — she has cards to act on');

// =============================================================================================
// 2. The production-discovery route the split rewrote, driven from THIS visitor's session.
//
//    No browser surface reaches it (recorded in family-placement-journey.mjs), so it is driven over
//    the wire on her own cookie — the same server, the same session record the deck above reads.
// =============================================================================================
await qa.note('AC1/AC3/AC5 — walking the production-discovery route on this visitor\'s own session');

// The two refusals whose CONDITION this ticket rewrote (`!discovery.floor` became
// `discovery.questionFloors.length === 0`). Nothing else in the repo exercises them.
const notStartedGet = await callAsVisitor('GET', '/onboarding/discovery/production');
await assertTrue(
  notStartedGet.status === 409 && notStartedGet.json?.error?.code === 'production_discovery_not_started',
  `nothing pinned yet, so resuming discovery refuses exactly as it always has: ${notStartedGet.status} ${notStartedGet.json?.error?.code}`,
);
const notStartedAnswer = await callAsVisitor('POST', '/onboarding/discovery/production/answer', {
  itemId: 'end-to-end-delivery', answer: 'Yes',
});
await assertTrue(
  notStartedAnswer.status === 409 && notStartedAnswer.json?.error?.code === 'production_discovery_not_started',
  `answering before starting refuses the same way: ${notStartedAnswer.status} ${notStartedAnswer.json?.error?.code}`,
);
const notCovered = await callAsVisitor('POST', '/onboarding/discovery/production/complete');
await assertTrue(
  notCovered.status === 409 && notCovered.json?.error?.code === 'essential_floor_not_covered',
  `completing before starting refuses the same way: ${notCovered.status} ${notCovered.json?.error?.code}`,
);

const evaluated = await callAsVisitor('POST', '/onboarding/discovery/production/evaluate');
await assertTrue(evaluated.status === 200, `a mapped target role is accepted: ${evaluated.status}`);
await assertTrue(
  evaluated.json?.floor?.familyId === FAMILY && evaluated.json?.floor?.version === 1,
  `AC5 — the answer on the wire is unchanged: it still carries floor=${JSON.stringify(evaluated.json?.floor)}`,
);
await assertTrue(
  evaluated.json?.checkpoint === 'family_confirmed' && typeof evaluated.json?.nextQuestion?.prompt === 'string',
  `discovery has a real next question to ask — the floor is live: "${evaluated.json?.nextQuestion?.prompt}"`,
);

// AC1 + AC5, read off the stored record: TWO facts now, and for a mapped role both name the one
// family. This is the assertion that would fail if the split had changed a mapped visitor's plan.
const pinned = (await json('/sessions/me'))?.discovery;
await qa.note(`the stored discovery record: ${JSON.stringify(pinned)}`);
await assertTrue(
  Array.isArray(pinned?.questionFloors) && pinned.questionFloors.length === 1 &&
    pinned.questionFloors[0].familyId === FAMILY && pinned.questionFloors[0].version === 1,
  'AC1 — the record holds an ordered list of question floors, and a mapped role puts exactly one in it',
);
await assertTrue(
  pinned?.searchFamily?.familyId === FAMILY && pinned?.searchFamily?.version === 1,
  'AC1/AC5 — the search family is a SEPARATE fact, and for a mapped role it is the same family',
);
await assertTrue(
  !('floor' in (pinned ?? {})),
  'AC2 — the single fact that did both jobs is gone from the record outright; no old key is kept alongside',
);

// Answer the whole floor, the way discovery would ask it, then complete.
for (let i = 0; i < 10; i += 1) {
  const state = await json('/onboarding/discovery/production');
  if (!state?.nextQuestion) break;
  if (i === 0) {
    const halfway = await callAsVisitor('POST', '/onboarding/discovery/production/complete');
    await assertTrue(
      halfway.status === 409 && halfway.json?.error?.code === 'essential_floor_not_covered',
      `the coverage checkpoint still holds mid-interview: ${halfway.status} ${halfway.json?.error?.code}`,
    );
  }
  await callAsVisitor('POST', '/onboarding/discovery/production/answer', {
    itemId: state.nextQuestion.itemId,
    answer: 'Yes, on several programmes',
  });
}
const completed = await callAsVisitor('POST', '/onboarding/discovery/production/complete');
await assertTrue(
  completed.status === 200 && completed.json?.checkpoint === 'essential_floor_covered' &&
    completed.json?.floor?.familyId === FAMILY,
  `AC5 — the floor completes and answers with the same shape as before: ${completed.status} ${completed.body.slice(0, 120)}`,
);

// AC3 — the pin invariant, extended to the pair: re-deriving the same plan is allowed (coverage
// advances under it), and the plan itself does not move.
const reEvaluated = await callAsVisitor('POST', '/onboarding/discovery/production/evaluate');
await assertTrue(
  reEvaluated.status === 200,
  `AC3 — re-deriving the SAME plan reconciles rather than refusing: ${reEvaluated.status}`,
);
const afterComplete = (await json('/sessions/me'))?.discovery;
await assertTrue(
  JSON.stringify(afterComplete?.questionFloors) === JSON.stringify(pinned?.questionFloors) &&
    JSON.stringify(afterComplete?.searchFamily) === JSON.stringify(pinned?.searchFamily),
  'AC3 — once pinned, the plan does not change under the session (both halves of the pair are the same as before)',
);
await assertTrue(
  afterComplete?.checkpoint === 'essential_floor_covered',
  'the coverage checkpoint advanced under the pinned plan, exactly as it always did',
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

const deckAfter = (await json('/onboarding/cards'))?.cards ?? [];
await qa.note(`the deck now: ${deckAfter.length} cards — ${deckAfter.map((c) => `${c.adId}=${c.matchPct}%`).slice(0, 4).join(', ')}`);
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
// 4. The visitor #235/#236 are FOR must still be refused today, byte for byte.
// =============================================================================================
await qa.note('the unmapped visitor — she is #235/#236\'s subject, and until they ship she must be refused exactly as on main');
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

const refused = await asOther('POST', '/onboarding/discovery/production/evaluate');
await qa.note(`the unmapped visitor's answer, verbatim: HTTP ${refused.status} ${refused.body.slice(0, 200)}`);
await assertTrue(
  refused.status === 409 && refused.json?.error?.code === 'placement_not_confirmed',
  `an unmapped target role is still refused with the same code: ${refused.status} ${refused.json?.error?.code}`,
);
await assertTrue(
  refused.json?.familyResearch?.path === '/family-learning/candidates' && refused.json?.rewardEligible === false,
  'the refusal still offers the family-research path and still authorizes no reward — an unchanged body, not a new one',
);
const otherRecord = (await asOther('GET', '/sessions/me')).json?.discovery;
await qa.note(`her stored discovery record: ${JSON.stringify(otherRecord)}`);
await assertTrue(
  Array.isArray(otherRecord?.questionFloors) && otherRecord.questionFloors.length === 0 &&
    otherRecord.searchFamily === null,
  'AC1 — nothing was pinned for her: no question floors, no search family (the CV floors #235 will ask are NOT pinned by this ticket)',
);
await other.dispose();

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
