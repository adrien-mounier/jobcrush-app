// #256 (AC1) — #229's change-of-direction sentence, re-run against a GENUINELY DERIVED known zero.
//
// WHY THIS FILE EXISTS, when apps/web/e2e/deck.spec.ts already has three #229 tests.
//
// Those three stub the cards payload and hand the browser `newToFamily: true`. They prove the
// RENDER (the sentence appears once, above the cards, never on the reveal) and nothing else. What
// they cannot prove is the half #229's own rule lives in: that the SERVER decides a visitor is a
// career changer by looking at her actual work history. A stub asserts our own opinion back at us —
// if `newToFamily()`'s derivation went dead tomorrow, all three would stay green.
//
// #256 became possible only because #255 published a SECOND family (business-analysis). With one
// published family there was no second family for a visitor's years to live in, so a derived known
// zero could not be constructed at all: every deck was either her family or unplaced.
//
// The visitor this journey drives:
//   - Her work history: two dated jobs, BOTH corrected into `business-analysis` through the real
//     correction door a person uses (POST /job-blocks/:id/correct, key "family") — not a test hook.
//     Both matter: `newToFamily` demands familySource === "zero", which requires EVERY counting job
//     to be placed. Leaving the coordinator unplaced yields "fallback", and the sentence correctly
//     stays silent. The derivation is strict, and this journey walks the strict version.
//   - Her target role: "IT project manager in Hong Kong" → `it-project-delivery`, the family the
//     shipped corpus actually holds adverts for, so she reaches a POPULATED deck rather than an
//     empty screen with a banner over it.
//   => zero years in the deck's family, nine-ish years elsewhere. The server derives the sentence.
//
// Nothing here sets `newToFamily`. It is read back off the wire and compared with the screen.
//
// Phase B is the control: the SAME stack, the same corpus, one difference — her jobs are left where
// the machine placed them (it-project-delivery, her target's own family). No known zero, no
// sentence. Without this half, "the banner is visible" is not evidence of a derivation; it is
// evidence of a banner.
//
// #229's inviolable rule is measured, not asserted about: every matchPct the payload carries is
// compared with the number rendered on the card. The words carry the truth, the score is untouched.
//
// Requires the Tier 2 stack: qa-main.js behind the web app's /api.
// Run:  BASE_URL=http://127.0.0.1:34200 node e2e/change-of-direction-derived-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

const TARGET_FAMILY = 'it-project-delivery'; // her target role's family — the corpus has these adverts
const OTHER_FAMILY = 'business-analysis'; // #255's second published family — where her years go
const ROLE = 'IT project manager in Hong Kong';
const SENTENCE = 'This is a change of direction';
// The two canned CV records that COUNT toward experience (qa-main.ts). The MSc is education and is
// deliberately not corrected — it must not need to be, and if it ever starts counting, the years
// arithmetic behind this journey changes and this list is where that shows up.
const COUNTING_BLOCKS = ['nordic-retail-it-pm', 'baltic-systems-coordinator'];

// The pasted CV. Its TEXT is not what decides the placements below — qa-main's miner answers with a
// canned, contract-valid set of records — but the paste door refuses anything this short of a real
// CV, so a person's actual work history is what goes in.
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

const qa = await createSession('change-of-direction-derived-journey', { baseURL: BASE });
const { page } = qa;

for (const ev of ['unhandledRejection', 'uncaughtException']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

let failures = 0;
/** A real assertion: green step + screenshot when true, red step + screenshot and a non-zero exit
 *  when false. Never a note nobody reads. */
async function check(ok, claim) {
  if (ok) return qa.expectVisible('body', `PASS — ${claim}`);
  failures += 1;
  return qa.expectVisible('#assertion-failed-see-note', `FAIL — ${claim}`);
}

const api = (method, path, data) => page.request.fetch(`${BASE}/api${path}`, { method, data });
const json = async (r) => (r.ok() ? r.json() : null);

/** Walks one visitor from the front door to a populated deck. `moveFamily` decides whether her
 *  work history is corrected out of her target's family — the ONE difference between the two
 *  phases, and therefore the only thing that may explain a different screen. */
async function visitor({ moveFamily, label }) {
  await qa.goto('/', `${label}: the front door — a brand-new visitor`);
  await qa.scrollThrough('read the front door as a person does');

  // #271: the CV comes in through the front door's paste tile, the way a person brings one.
  await qa.frontDoorPaste(CV_TEXT, `${label}: her real dated work history, pasted on the front door`);
  await qa.completeReview(); // #338: a brought CV is reviewed before any job is shown (ADR-0016 clause 6)

  let blocks = [];
  for (let i = 0; i < 60; i += 1) {
    const j = await json(await api('GET', '/job-blocks'));
    if (j && (j.blocks ?? []).length) { blocks = j.blocks; break; }
    await page.waitForTimeout(500);
  }
  const placementOf = (b) => (b.family?.value?.families ?? []).map((f) => f.familyId).join('+') || 'unplaced';
  qa.note(
    `${label}: the product read ${blocks.length} dated records — ` +
      blocks.map((b) => `${b.title.value} [${b.kind}, counts: ${b.countsTowardExperience}] → ${placementOf(b)}`).join('; '),
  );

  if (moveFamily) {
    // The real correction door. A person disagreeing with where the machine filed her work is the
    // ONLY mechanism used here to create the known zero — no injected flag, no seeded years.
    const codes = [];
    for (const id of COUNTING_BLOCKS) {
      const r = await api('POST', `/job-blocks/${id}/correct`, {
        key: 'family',
        value: { familyId: OTHER_FAMILY, version: 2 },
      });
      codes.push(`${id}: ${r.status()}`);
    }
    qa.note(`${label}: corrected both counting jobs into "${OTHER_FAMILY}" via the real correction door — ${codes.join(', ')}`);
    const after = await json(await api('GET', '/job-blocks'));
    qa.note(
      `${label}: her work history now reads — ` +
        (after?.blocks ?? []).map((b) => `${b.title.value} → ${placementOf(b)}`).join('; '),
    );
  }

  // Discovery: her target role is what pins the deck's family.
  await qa.goto('/discovery', `${label}: into the sign-up questions`);
  await qa.fill('#q1-role', ROLE, 'the role she is going for — this pins the deck to her TARGET family');
  await qa.click('button.go.wide', 'answer the role question');
  await page.waitForTimeout(2500);
  const seeded = await qa.seedFloorAnswers({ yes: 'Yes, across three vendor teams' });
  qa.note(`${label}: answered the floor — ${seeded.join(', ') || 'nothing left to answer'}`);

  // Wanting a job requires an account; the wall stands between "See them" and the cards, and this
  // journey is about what the deck SAYS, not about the wall.
  const signIn = await page.evaluate(async (email) => {
    const link = await fetch('/api/auth/request-link', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
    }).then((r) => r.json());
    const token = new URL('http://x' + link.devLink).searchParams.get('token');
    return fetch('/api/auth/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    }).then((r) => r.status);
  }, `cod-${Date.now()}@example.com`);
  qa.note(`${label}: signed in over the real API — /auth/verify ${signIn}`);

  // The deck is fed by retrieval, which does not block the first read — wait the search out.
  let deck = { cards: [] };
  for (let i = 0; i < 120; i += 1) {
    deck = await json(await api('GET', '/onboarding/cards')) ?? { cards: [] };
    if (deck.searching !== true && (deck.cards ?? []).length) break;
    await page.waitForTimeout(500);
  }
  return deck;
}

// ================================================================= Phase A: the career changer ===
qa.note(
  'PHASE A — her nine years are in ' + OTHER_FAMILY + '; she is aiming at ' + TARGET_FAMILY +
    '. Zero years in the deck\'s family, real years elsewhere: the server should derive a change of direction.',
);
const changer = await visitor({ moveFamily: true, label: 'career changer' });

qa.note(
  `career changer: the SERVER answered newToFamily=${changer.newToFamily} with ` +
    `${(changer.cards ?? []).length} card(s) — scores ${(changer.cards ?? []).map((c) => c.matchPct).join(', ')}`,
);
await check(
  (changer.cards ?? []).length > 0,
  `she reaches a POPULATED deck (${(changer.cards ?? []).length} cards) — the sentence is being tested over real adverts, not over an empty screen`,
);
await check(
  changer.newToFamily === true,
  'the SERVER derived the known zero from her corrected work history alone — newToFamily=true came off the wire, nothing in this run set it',
);

await qa.goto('/deck', 'career changer: the deck, as she sees it');
await qa.expectVisible('button:has-text("See them")', 'the reveal — the sentence must NOT be here, the count needs no caveat');
await check(
  (await page.getByText(SENTENCE).count()) === 0,
  '#229 placement: the reveal carries no change-of-direction sentence',
);
await qa.click('button:has-text("See them")', 'she asks to see the jobs');
await page.waitForTimeout(1500);
await qa.scrollThrough('read the deck top to bottom, as a person does');

await qa.expectVisible('p.newfamily', 'the change-of-direction sentence, above the cards');
await qa.expectText('p.newfamily', SENTENCE, '#229 AC — she is TOLD this is a change of direction, in the words the ticket specified');
await check(
  (await page.locator('p.newfamily').count()) === 1,
  '#229 placement: the sentence appears exactly ONCE, above the deck — never repeated per card',
);

// #229's inviolable rule, measured: the words carry the truth, the score is untouched.
const onScreen = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[aria-label$="% match"]')).map((el) =>
    Number(el.getAttribute('aria-label').replace('% match', '')),
  ),
);
const fromServer = (changer.cards ?? []).map((c) => c.matchPct).filter((n) => n !== null);
qa.note(`career changer: scores the server sent [${fromServer.join(', ')}] · scores rendered on screen [${onScreen.join(', ')}]`);
await check(
  onScreen.length > 0 && onScreen.every((n) => fromServer.includes(n)),
  `#229's inviolable rule, MEASURED: every score on screen is a score the server sent (${onScreen.join(', ')}) — the sentence is copy, it moved no arithmetic`,
);

// ================================================================ Phase B: the control visitor ===
// Same stack, same corpus, same target role. Her jobs stay where the machine placed them.
await page.context().clearCookies();
qa.note(
  'PHASE B (control) — identical in every way except one: her work history is left in ' +
    TARGET_FAMILY + ', her target\'s own family. No known zero exists, so no sentence may appear. ' +
    'This is what makes Phase A evidence of a DERIVATION rather than evidence of a banner.',
);
const native = await visitor({ moveFamily: false, label: 'control visitor' });
qa.note(
  `control visitor: the SERVER answered newToFamily=${native.newToFamily} with ${(native.cards ?? []).length} card(s)`,
);
await check(
  (native.cards ?? []).length > 0,
  `the control reaches a populated deck too (${(native.cards ?? []).length} cards) — the two phases differ only in where her years sit`,
);
await check(
  native.newToFamily === false,
  'the server does NOT claim a change of direction for a visitor already working in her target family — the derivation discriminates',
);

await qa.goto('/deck', 'control visitor: the deck');
await qa.click('button:has-text("See them")', 'she asks to see the jobs');
await page.waitForTimeout(1500);
await qa.scrollThrough('read the control deck top to bottom');
await check(
  (await page.getByText(SENTENCE).count()) === 0,
  'no change-of-direction sentence is shown to a visitor who is not changing direction',
);

const ok = await qa.finish();
process.exit(ok && failures === 0 ? 0 : 1);
