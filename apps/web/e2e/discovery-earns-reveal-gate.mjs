// #216 QA GATE — the questions she is ASKED are the questions the reveal is EARNED from.
//
// The defect #216 exists to close: a visitor could answer every question on screen, truthfully and
// positively, and still reach the deck with `{ family: null, checkpoint: null }`. The shipped screen
// (/onboarding/discovery/*) never wrote `session.discovery`; a parallel /onboarding/discovery/
// production/* interview was its only writer and no client ever called it.
//
// This journey is the independent gate over that. It differs from discovery-plan-split-journey.mjs
// in three ways on purpose:
//   1. Every floor answer is a REAL CLICK on the screen's own option button (`.opts button.opt`),
//      not a POST from the page's fetch — so what is proven is that the button a person presses is
//      what moves her durable record.
//   2. It drives BOTH ends of the fake labeler: a placed target role and an unplaceable one, each
//      in a real browser with a real screen, so "what an unplaceable role gets" is judged on what
//      she sees, not on a payload.
//   3. It probes the surviving non-visitor surface (#59's fixture seam) for a reveal it must not be
//      able to authorize.
//
// The correction rule asserted here is the CURRENT decided one — spec #233 decision 6 / #235's
// coverage AC: an explicit "no" is a real ANSWER and keeps the item covered. #216's own AC3, written
// 2026-08-14, says a correction to "no" must drop the checkpoint back; that text predates the
// decision and is superseded by it. Asserted the decided way, and noted in the report either way.
//
// Run it:
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # fake-model API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34878
//   BASE_URL=http://127.0.0.1:34878 node apps/web/e2e/discovery-earns-reveal-gate.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time, so the API must be listening before `next build`. Run serially: the run mints anonymous
// sessions and one magic-link sign-in, both capped per IP.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34878';
// The fake labeler (qaFamilyAnswer.ts) places project|programme|delivery|scrum|pm into the one
// published family and answers "unmapped" for everything else.
const PLACED_ROLE = 'IT project manager';
const UNPLACEABLE_ROLE = 'sous vide pastry chef';
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

const qa = await createSession('discovery-earns-reveal-gate', {
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

// Ask the API the way this visitor's own browser does — her cookie, her session, the same server.
async function callAsVisitor(method, path, data) {
  const res = await page.request.fetch(`${BASE}/api${path}`, { method, ...(data ? { data } : {}) });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* a non-JSON body is itself the finding */ }
  return { status: res.status(), body, json: parsed };
}
const json = async (path) => (await callAsVisitor('GET', path)).json;
const record = async () => (await json('/sessions/me'))?.discovery;

// The front door, through to a CV the product has actually read.
async function walkIntoDiscovery(role) {
  // #271: the CV goes in first, through the front door's paste tile — the order a person walks
  // (the deleted /paste side entrance used to let these steps run backwards).
  await qa.frontDoorPaste(CV_TEXT, `the front door — ${role}: she pastes her CV, two dated jobs and one degree`);
  await qa.completeReview(); // #338: a brought CV is reviewed before any job is shown (ADR-0016 clause 6)
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', role, `the job she is going for: "${role}"`);
  await qa.fill('#search-area', AREA, 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1200);
  let blocks = [];
  for (let i = 0; i < 60; i += 1) {
    const b = await json('/job-blocks');
    if (b?.blocks?.length) { blocks = b.blocks; break; }
    await page.waitForTimeout(500);
  }
  await qa.note(
    `the product read ${blocks.length} dated records:\n` +
    blocks.map((b) => `  - ${b.employer?.value} (${b.kind}) -> ${b.family?.value?.outcome ?? 'not labeled'}`).join('\n'),
  );

  await qa.goto('/discovery', 'into discovery — the sign-up questions');
  // #322: the front door already took the role, so discovery opens on the checklist - no question 1.
  await page.waitForTimeout(2500);
  await qa.scrollThrough('read the discovery screen the way a real visitor would');
  return blocks;
}

/** Answer the floor questions the SCREEN puts to her, by clicking its own option buttons. Returns
 *  the item ids she was actually asked, read off the state rather than hard-coded — the whole point
 *  of the ticket is that these come from a published family floor, so a fixed list would be
 *  asserting yesterday's question set. */
async function answerFloorQuestionsOnScreen(limit = 8) {
  const asked = [];
  for (let i = 0; i < limit; i += 1) {
    const state = await json('/onboarding/discovery');
    const next = (state?.questions ?? []).find((q) => !q.eligibility);
    if (!next) break;
    // The screen types the answered item's CV line out before it renders the next question, so the
    // control arrives a beat after the state does. Floor items come in two forms — tap-an-option
    // and type-your-own — so wait for whichever this item is and answer it the way she would.
    const opts = page.locator('.opts button.opt');
    const freeText = page.locator('#floor-free');
    try {
      await page.locator('.opts button.opt, #floor-free').first().waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      await qa.note(`the screen never offered a control for "${next.itemId}" — stopping the answer loop`);
      break;
    }
    const heading = (await page.locator('.ask .q').first().innerText().catch(() => '(no question)'))
      .replace(/\s+/g, ' ').slice(0, 90);

    if (await opts.count()) {
      // Pick a positive option: the first that is not a bare "no".
      const count = await opts.count();
      let chosen = opts.first();
      for (let k = 0; k < count; k += 1) {
        const label = (await opts.nth(k).innerText()).trim();
        if (!/^no[.!]?$/i.test(label)) { chosen = opts.nth(k); break; }
      }
      const label = (await chosen.innerText()).trim();
      await qa.click(chosen, `she is asked "${heading}" — she presses "${label}"`);
    } else {
      await qa.fill(freeText, 'Yes, across three vendor teams and the steering group', `she is asked "${heading}" — she types her own answer`);
      await qa.click('.ask button.go', 'Continue — she sends her typed answer');
    }
    await page.waitForTimeout(1500);
    asked.push(next.itemId);
  }
  return asked;
}

// =============================================================================================
// 1. THE PLACED VISITOR — the questions on her screen are the ones the reveal is earned from.
// =============================================================================================
await walkIntoDiscovery(PLACED_ROLE);

const before = await record();
await qa.note(`her durable record BEFORE she answers anything: ${JSON.stringify(before)}`);
await assertTrue(
  before?.questionFloors?.[0]?.familyId === FAMILY && before?.searchFamily?.familyId === FAMILY,
  `AC1 — answering question 1 already pinned her placed family's PUBLISHED floor to her session (${JSON.stringify(before?.questionFloors)})`,
);

const asked = await answerFloorQuestionsOnScreen();
await qa.note(`the questions her own screen put to her, in the order she was asked: ${asked.join(', ') || '(none)'}`);
await assertTrue(
  asked.length >= 4,
  `AC1 — the shipped screen asked her the researched family floor, not a seven-item stub (${asked.length} items: ${asked.join(', ')})`,
);

await qa.goto('/discovery', 'back into discovery — her answers are in');
await qa.scrollThrough('read the answered discovery screen, top to bottom');

const earned = await record();
await qa.note(`the durable record her OWN button presses produced: ${JSON.stringify(earned)}`);
await assertTrue(
  earned?.checkpoint === 'essential_floor_covered',
  `AC2 — pressing the buttons on her screen is what earned the checkpoint; before #216 this stayed null forever (${earned?.checkpoint})`,
);
await assertTrue(
  earned?.searchFamily?.familyId === FAMILY && earned?.searchFamily?.version === 2,
  `AC5 — the family retrieval will search with is stored against her session (${JSON.stringify(earned?.searchFamily)})`,
);
await assertTrue(
  asked.every((id) => (earned?.coveredItemIds ?? []).includes(id)),
  `AC2 — every item she pressed an answer for is recorded as covered (${JSON.stringify(earned?.coveredItemIds)})`,
);

// The reveal itself, on the screen: the state above is what /onboarding/cards retrieves on.
await qa.goto('/deck', 'the reveal');
await qa.expectVisible('.jobdeck', 'the reveal screen — the deck sits behind the sign-in wall (#21)');
await qa.scrollThrough('read the reveal the way a visitor decides whether to sign in');
const signIn = await callAsVisitor('POST', '/auth/request-link', { email: `reveal-gate-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await callAsVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });
await qa.goto('/deck', 'back to the deck, now past the wall');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: she reached the card deck');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: a real scored card, not a blank screen');
await qa.scrollThrough('read the first deck card top to bottom, the way a job seeker would');
const deckBefore = (await json('/onboarding/cards'))?.cards ?? [];
await assertTrue(deckBefore.length > 0, `the deck is not empty — she has ${deckBefore.length} cards to act on`);

// =============================================================================================
// 2. A CORRECTION. The decided rule (#233 decision 6) is that an explicit "no" is an ANSWER.
// =============================================================================================
const corrected = asked[0];
await callAsVisitor('POST', '/onboarding/discovery/answer', { itemId: corrected, answer: 'No' });
const afterNo = await record();
await qa.note(
  `she corrects "${corrected}" to a plain "No" -> ${JSON.stringify({ checkpoint: afterNo?.checkpoint, covered: afterNo?.coveredItemIds })}\n` +
  `  Decided rule: spec #233 decision 6 — coverage is "positively OR by an explicit negative", so the checkpoint HOLDS.\n` +
  `  #216's own AC3 (written 2026-08-14, before that decision) asks for the opposite and is superseded.`,
);
await assertTrue(
  afterNo?.coveredItemIds?.includes(corrected) && afterNo?.checkpoint === 'essential_floor_covered',
  `an honest "No" is an answer, not a hole — the item stays covered (#233 decision 6) (${afterNo?.checkpoint})`,
);

// =============================================================================================
// 3. ONE ENGINE. The parallel interview is gone from the server, and the one non-visitor surface
//    that survives cannot pin a family or authorize a reveal.
// =============================================================================================
for (const [method, path] of [
  ['GET', '/onboarding/discovery/production'],
  ['POST', '/onboarding/discovery/production/evaluate'],
  ['POST', '/onboarding/discovery/production/answer'],
  ['POST', '/onboarding/discovery/production/complete'],
]) {
  const gone = await callAsVisitor(method, path, method === 'POST' ? {} : undefined);
  await assertTrue(gone.status === 404, `AC6: ${method} ${path} no longer exists (${gone.status})`);
}

// #59's fixture seam is the only other discovery surface left. It reads an isolated fixture catalog
// that production never populates, so a visitor handing it a REAL published family gets nothing —
// and, whatever it answers, it writes no plan and no checkpoint.
const REAL_PLACEMENT = {
  schemaVersion: '2',
  outcome: 'confirmed',
  families: [{ familyId: FAMILY, version: 2 }],
  confidence: 'certain',
};
const fixtureBefore = await record();
const fixtureEval = await callAsVisitor('POST', '/onboarding/discovery/fixture/evaluate', { placement: REAL_PLACEMENT });
const fixtureAnswer = await callAsVisitor('POST', '/onboarding/discovery/fixture/answer', {
  placement: REAL_PLACEMENT, itemId: 'end-to-end-delivery', answer: 'Yes',
});
const fixtureAfter = await record();
await qa.note(`#59 fixture seam handed a real published family: evaluate ${fixtureEval.status} ${fixtureEval.body.slice(0, 90)} | answer ${fixtureAnswer.status}`);
await assertTrue(
  JSON.stringify(fixtureBefore) === JSON.stringify(fixtureAfter),
  `AC6: the fixture seam changed nothing about her plan or her checkpoint — it cannot authorize a reveal (${JSON.stringify(fixtureAfter)})`,
);
await assertTrue(
  fixtureEval.json?.rewardEligible !== true && fixtureAnswer.json?.rewardEligible !== true,
  'AC6: the fixture seam never returns a reward-eligible state',
);

// =============================================================================================
// 4. THE UNPLACEABLE VISITOR. A fresh browser session in the same window: what does she SEE?
// =============================================================================================
await page.context().clearCookies();
await qa.note('a second visitor, in a clean browser session: her target role is one no published family covers');
await walkIntoDiscovery(UNPLACEABLE_ROLE);

const screenText = (await page.locator('body').innerText()).toLowerCase();
const errorish = ['something went wrong', 'error', 'not found', 'we could not place', 'unmapped', 'try again later']
  .filter((phrase) => screenText.includes(phrase));
await assertTrue(
  errorish.length === 0,
  `AC4: an unplaceable target role is not an error surface — nothing on her screen reads as a failure (found: ${errorish.join(', ') || 'nothing'})`,
);
await qa.expectVisible('#ask-q', 'AC4: she gets a working interview — a real question, not a dead end');

const unplaced = await record();
await qa.note(`her durable record: ${JSON.stringify(unplaced)}`);
await assertTrue(
  unplaced?.searchFamily === null,
  `AC4: no family is silently pinned as the one to SEARCH with — retrieval will use her own words (${JSON.stringify(unplaced?.searchFamily)})`,
);
await assertTrue(
  unplaced?.checkpoint !== 'essential_floor_covered' || (unplaced?.questionFloors?.length ?? 0) === 0,
  `AC4: a covered checkpoint is only ever written against floors she was actually asked (${JSON.stringify(unplaced)})`,
);
await qa.note(
  `#235/#233 decision 3: with no target family she is interviewed on the floors her own CV proves — ` +
  `here ${JSON.stringify(unplaced?.questionFloors)}. That is question floors, NOT a search family.`,
);

const unplacedAsked = await answerFloorQuestionsOnScreen();
await qa.note(`the unplaceable visitor answered: ${unplacedAsked.join(', ') || '(nothing was asked)'}`);
const unplacedAfter = await record();
await assertTrue(
  unplacedAfter?.searchFamily === null,
  `AC4: answering everything still authorizes no family reveal for her (${JSON.stringify(unplacedAfter?.searchFamily)})`,
);

await qa.goto('/deck', 'the unplaceable visitor reaches the reveal too');
await qa.scrollThrough('read her reveal screen — she is served, never refused');
const herDeck = await callAsVisitor('GET', '/onboarding/cards');
await assertTrue(
  herDeck.status === 200,
  `AC4: her deck answers, it does not refuse (${herDeck.status} ${herDeck.json?.error?.code ?? ''})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
