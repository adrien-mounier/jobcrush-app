// #248 QA GATE — fetching postings and being ALLOWED TO SEE them are two decisions, not one.
//
// The property #248 exists to create: the "has she earned her reveal?" test left the provider fetch
// and moved onto the deck's own read, so it now runs on EVERY read whether or not a retrieval
// snapshot already exists. #246 will search at question 1 — before she has answered anything — so
// that the promise on her first screen can state a true job count. From that moment a real,
// fresh, fingerprint-matching snapshot exists for a session that has earned nothing, and the only
// thing standing between it and her deck is this check.
//
// What this journey adds that no other journey covers: it drives the UNCOVERED half from a real
// browser and asks the server, over her own session cookie, on every door that can put a retrieved
// posting in front of her. discovery-earns-reveal-gate.mjs proves she EARNS the checkpoint by
// pressing buttons; this one proves what the checkpoint is worth while it is still unearned — and
// that the refusal is answered on the spot, with no provider call and nothing stored.
//
// The half this cannot reach from a browser is planting a live snapshot at an uncovered checkpoint
// (no HTTP surface writes one). That is covered at the server level by
// apps/api/test/postingRetrieval.test.ts "#248 a snapshot is data, not permission".
//
// Run it:
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # fake-model API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34878
//   BASE_URL=http://127.0.0.1:34878 node apps/web/e2e/snapshot-is-not-permission-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time, so the API must be listening before `next build`. Run serially: it mints an anonymous
// session and one magic-link sign-in, both capped per IP.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34878';
// The fake labeler (qaFamilyAnswer.ts) places project|programme|delivery|scrum|pm into the one
// published family, so this visitor gets a real question floor to be gated on.
const PLACED_ROLE = 'IT project manager';
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

const qa = await createSession('snapshot-is-not-permission', {
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

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);

// Ask the server the way her own browser does — in-page fetch, so the session cookie rides along
// (Playwright's request context will not attach a Secure cookie over http://127.0.0.1).
async function callAsVisitor(method, path, data) {
  return page.evaluate(
    async ([m, p, d]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        ...(d ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) } : {}),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* a non-JSON body is itself the finding */ }
      return { status: res.status, body: text.slice(0, 400), json };
    },
    [method, path, data ?? null],
  );
}
const getJson = async (path) => (await callAsVisitor('GET', path)).json;
const record = async () => (await getJson('/sessions/me'))?.discovery;
// #248 D1: `/sessions/me` no longer hands out `retrieval` at all — it carried the whole live advert
// list to a visitor who had not earned it, which is the very leak this journey exists to catch. So
// "did an unearned read start work?" is asked of the DECK's own retrieval status instead: refused on
// the spot reads `invalid_request`, whereas work that started reads `provider_unavailable` with
// "in progress". Asking the session record would now answer null whatever happened - a probe that
// cannot fail is not a probe.
const deckRetrievalStatus = async () => (await getJson('/onboarding/cards'))?.retrieval ?? null;

// =============================================================================================
// 1. WALK HER IN. Placed target role, a CV the product has actually read, into discovery.
// =============================================================================================
await qa.goto('/', 'the front door');
await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');
// #271: the CV goes in first, through the front door's paste tile — the order a person walks
// (the deleted /paste side entrance used to let these steps run backwards).
await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV — two dated jobs and one degree');
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', PLACED_ROLE, `the job she is going for: "${PLACED_ROLE}"`);
await qa.fill('#search-area', AREA, 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForTimeout(1200);
for (let i = 0; i < 60; i += 1) {
  const b = await getJson('/job-blocks');
  if (b?.blocks?.length) break;
  await page.waitForTimeout(500);
}

await qa.goto('/discovery', 'into discovery — the sign-up questions');
// #322: the front door already took the role, so discovery opens on the checklist — no question 1.
await page.waitForTimeout(2500);
await qa.scrollThrough('read the discovery screen the way a real visitor would');

// She signs in now, so the post-wall doors (/want, /tailor) are reachable and their refusal below
// is about the floor, not about the sign-in wall.
const signIn = await callAsVisitor('POST', '/auth/request-link', { email: `snapshot-gate-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await callAsVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });

// =============================================================================================
// 2. THE UNCOVERED MOMENT. She has a pinned family floor and has answered none of it.
//    This is exactly the state #246's question-1 search will hold a live snapshot in.
// =============================================================================================
const before = await record();
await qa.note(`her durable record before she answers her floor: ${JSON.stringify(before)}`);
await assertTrue(
  before?.searchFamily?.familyId === FAMILY && (before?.questionFloors?.length ?? 0) > 0,
  `she has a real question floor to be gated on — a search family and floors are pinned (${JSON.stringify(before?.questionFloors)})`,
);
await assertTrue(
  before?.checkpoint !== 'essential_floor_covered',
  `and she has NOT earned her reveal yet (checkpoint: ${before?.checkpoint})`,
);

// The deck read, THREE times. #248's own words: "the test runs on EVERY deck read, whether or not a
// snapshot already exists." One refusal followed by a served second read is the exact shape of the
// bug this ticket closes, so read it more than once.
//
// Read the coordination state BEFORE them, so the check further down measures what these reads did
// rather than what she did on her way here.
const sessionBeforeReads = await getJson('/sessions/me');
const generationBeforeReads = sessionBeforeReads?.retrievalGeneration;
const fingerprintBeforeReads = sessionBeforeReads?.retrievalCoordinationFingerprint;
for (const attempt of [1, 2, 3]) {
  const cards = await callAsVisitor('GET', '/onboarding/cards');
  const retrieval = cards.json?.retrieval;
  await assertTrue(
    cards.status === 200 &&
      retrieval?.outcome === 'invalid_request' &&
      retrieval?.code === 'floor_not_covered',
    `deck read ${attempt} of 3 is refused with the unchanged wire code (${cards.status} ${JSON.stringify(retrieval)})`,
  );
  await assertTrue(
    !('postings' in (retrieval ?? {})),
    `deck read ${attempt} of 3 carries no retrieved postings at all — the refusal has no payload to leak (keys: ${Object.keys(retrieval ?? {}).join(', ')})`,
  );
}

// Answered on the spot: no provider call, no claim, nothing persisted against her session. If an
// uncovered read ever started work, this is where it would show up.
const statusWhileUncovered = await deckRetrievalStatus();
await qa.note(`what her deck says about retrieval while uncovered: ${JSON.stringify(statusWhileUncovered)}`);
await assertTrue(
  statusWhileUncovered?.outcome === 'invalid_request' && statusWhileUncovered?.code === 'floor_not_covered',
  `an unearned deck is refused on the spot, not queued — no provider call, no claim (${JSON.stringify(statusWhileUncovered)})`,
);

// #248 D1, closed: the session record she can read in her own browser must not carry the advert
// pool. Nothing renders it, so this would never have shown on screen — it would just have been
// sitting in devtools for every uncovered visitor the moment #246 starts searching early.
const ownSession = await getJson('/sessions/me');
await assertTrue(
  ownSession !== null && !('retrieval' in ownSession),
  `her own session record carries no retrieved postings at all (keys: ${Object.keys(ownSession ?? {}).join(', ')})`,
);
// ...and an INDEPENDENT look at persisted state, which the check above no longer gives: the
// coordination fingerprint is written by reconcileRetrievalState the moment retrieval work
// completes, and the generation counts the times her own inputs changed. A hash and an integer — no
// advert data rides on them, so exposing them carries none of the risk the field above did.
//
// Two false premises have been corrected here, both the same mistake: reading a value that ALREADY
// MOVED on her way to the deck as if it proved something about the deck.
//   - `retrievalGeneration === 0` — wrong when it was written; the generation is bumped by her
//     intent write and by her floor being pinned, both on the discovery screen above.
//   - `retrievalCoordinationFingerprint === null` — wrong since #246, and note the comment fifteen
//     lines up already saw it coming ("the moment #246 starts searching early"). Question 1 now buys
//     one real search so the promise on her first screen can state a true count, and that search
//     legitimately claims and reconciles. A null fingerprint here would now mean the promise never
//     searched, which is a DIFFERENT ticket's failure, not this one's success.
// What this check means to say — an uncovered read starts no work of its own — is what it asserts:
// neither value MOVES across the three refused reads. Same evidence, no false premise. That the
// early snapshot is data and not permission is what the rest of this journey proves, above and
// below: refused on the spot, no postings on her session record, and both id-guessing doors shut.
const genAfterRefusedReads = ownSession?.retrievalGeneration;
const fingerprintAfterRefusedReads = ownSession?.retrievalCoordinationFingerprint;
await assertTrue(
  fingerprintAfterRefusedReads === fingerprintBeforeReads && genAfterRefusedReads === generationBeforeReads,
  `an unearned deck claimed nothing and reconciled nothing against her session ` +
    `(fingerprint ${JSON.stringify(fingerprintBeforeReads)} -> ${JSON.stringify(fingerprintAfterRefusedReads)}, ` +
    `generation ${generationBeforeReads} -> ${genAfterRefusedReads}, both unmoved by three refused reads)`,
);

// The other two doors onto the same posting pool. Both take an ad id straight from the URL, so both
// are reachable without ever seeing a card.
const GUESSED_ID = 'posting:qa248-guessed-live-advert';
const want = await callAsVisitor('POST', `/onboarding/cards/${encodeURIComponent(GUESSED_ID)}/want`);
await assertTrue(
  want.status === 404,
  `guessing a live advert id at the want door gets the same 404 as an unknown card — no oracle, no leak (${want.status} ${want.body})`,
);

const tailorWhileUncovered = await callAsVisitor('GET', '/onboarding/tailor');
await assertTrue(
  tailorWhileUncovered.status === 409 || tailorWhileUncovered.status === 404,
  `and the tailor surface has nothing to show her either (${tailorWhileUncovered.status} ${tailorWhileUncovered.body})`,
);

// What she SEES at the reveal while the floor is uncovered: the product asks for more, it does not
// hand her a retrieved deck.
await qa.goto('/deck', 'the reveal, while her floor is still uncovered');
await qa.scrollThrough('read the uncovered reveal top to bottom');
const uncoveredDeck = await getJson('/onboarding/cards');
await qa.note(
  `the uncovered reveal: retrieval ${JSON.stringify(uncoveredDeck?.retrieval)}, ` +
  `moreQuestions=${uncoveredDeck?.moreQuestions}, searching=${uncoveredDeck?.searching}`,
);
await assertTrue(
  uncoveredDeck?.searching !== true,
  'she is not shown a spinner she can never get past — the refusal is a settled answer, not "still searching"',
);

// =============================================================================================
// 3. SHE EARNS IT, ON THE SCREEN. Nothing about the served half may have regressed.
// =============================================================================================
await qa.goto('/discovery', 'back into discovery — she answers her floor');
const asked = await qa.answerFloorOnScreen();
await qa.note(`the questions her own screen put to her: ${asked.join(', ') || '(none)'}`);
await assertTrue(asked.length >= 3, `she was asked her family's researched floor (${asked.length} items)`);

const earned = await record();
await assertTrue(
  earned?.checkpoint === 'essential_floor_covered',
  `pressing the buttons on her screen is what earned the checkpoint (${earned?.checkpoint})`,
);

const servedDeck = await callAsVisitor('GET', '/onboarding/cards');
await qa.note(`the same deck read, now that she has earned it: ${JSON.stringify(servedDeck.json?.retrieval)}`);
await assertTrue(
  servedDeck.json?.retrieval?.code !== 'floor_not_covered',
  `the SAME read that was refused three times is no longer refused — coverage is the only thing that changed (${JSON.stringify(servedDeck.json?.retrieval)})`,
);

await qa.goto('/deck', 'the reveal she has now earned');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: she reached the card deck');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: a real scored card, not a blank screen');
await qa.scrollThrough('read the first deck card top to bottom, the way a job seeker would');
const finalCards = (await getJson('/onboarding/cards'))?.cards ?? [];
await assertTrue(finalCards.length > 0, `the deck is not empty — she has ${finalCards.length} scored cards to act on`);

// And the want door, refused a moment ago, now opens on a card she can actually see.
const realAdId = finalCards[0]?.adId;
const wantNow = await callAsVisitor('POST', `/onboarding/cards/${encodeURIComponent(realAdId)}/want`);
await assertTrue(
  wantNow.status === 200,
  `the want door she was refused at is open on a card she earned (${wantNow.status} for ${realAdId})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
