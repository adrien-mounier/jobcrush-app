// #248 QA GATE — fetching postings and being ALLOWED TO SEE them are two decisions, not one.
//
// The property #248 exists to create: the "has she earned her reveal?" test left the provider fetch
// and moved onto the deck's own read, so it now runs on EVERY read whether or not a retrieval
// snapshot already exists. #246 will search at question 1 — before she has answered anything — so
// that the promise on her first screen can state a true job count. From that moment a real,
// fresh, fingerprint-matching snapshot exists for a session that has earned nothing, and the only
// thing standing between it and her deck is this check.
//
// #339 changed WHAT she earns her deck with, not the property. The floor-coverage gate is gone with
// the floor questions; the one gate left is a brought CV's completed "Your CV, reviewed" (#338,
// ADR-0016 clause 6). So the visitor here brings a CV, gets a real question-1 search (the promise
// on her screen counts it), and is refused on every door until she confirms her review.
//
// What this journey adds that no other journey covers: it drives the UNEARNED half from a real
// browser and asks the server, over her own session cookie, on every door that can put a retrieved
// posting in front of her, while a live snapshot exists — and proves the refusal is answered on the
// spot, with no provider call and nothing stored. cv-review-gate-doors-journey.mjs walks the same
// gate from the review screen's side.
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
// published family, so this visitor's question-1 search runs on a real family.
const PLACED_ROLE = 'IT project manager';
const AREA = 'Singapore';

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

// =============================================================================================
// 1. WALK HER IN. Placed target role, a CV the product has actually read, into discovery.
// =============================================================================================
await qa.goto('/', 'the front door');
await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');
// #271: the CV goes in first, through the front door's paste tile — the order a person walks
// (the deleted /paste side entrance used to let these steps run backwards).
await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV — two dated jobs and one degree');
// Her review is left OPEN on purpose: it is the one gate #339 left standing, and §2 attacks it.
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
// is about her unreviewed CV, not about the sign-in wall.
const signIn = await callAsVisitor('POST', '/auth/request-link', { email: `snapshot-gate-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await callAsVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });

// =============================================================================================
// 2. THE UNEARNED MOMENT. #246's question-1 search has run — a live snapshot exists — and she has
//    not reviewed her CV.
// =============================================================================================
const discoveryNow = await getJson('/onboarding/discovery');
await qa.note(`her discovery state: promise ${JSON.stringify(discoveryNow?.promise)}, reviewPending ${discoveryNow?.reviewPending}`);
await assertTrue(
  (discoveryNow?.promise?.count ?? 0) > 0,
  `a real search already ran at question 1 — her screen promises ${discoveryNow?.promise?.count} jobs, so a live snapshot exists`,
);
await assertTrue(
  discoveryNow?.reviewPending === true,
  `and she has NOT earned her deck yet — her CV review is still open (reviewPending ${discoveryNow?.reviewPending})`,
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
  await assertTrue(
    cards.status === 200 && cards.json?.reviewPending === true && (cards.json?.cards ?? []).length === 0,
    `deck read ${attempt} of 3 is refused — no cards, reviewPending (${cards.status} ${cards.body.slice(0, 160)})`,
  );
  // Answered on the spot: the refusal comes back before retrieval is even consulted, so it carries
  // no retrieval status and no postings — nothing to leak, and no work started.
  await assertTrue(
    !('retrieval' in (cards.json ?? {})) && cards.json?.searching === false,
    `deck read ${attempt} of 3 carries no retrieval at all and is not "still searching" — refused on the spot, not queued (keys: ${Object.keys(cards.json ?? {}).join(', ')})`,
  );
}

// #248 D1, closed: the session record she can read in her own browser must not carry the advert
// pool. Nothing renders it, so this would never have shown on screen — it would just have been
// sitting in devtools for every unearned visitor the moment #246 starts searching early.
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
//     intent write and by her plan being pinned, both on the discovery screen above.
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

// What she SEES at the reveal while her review is open: the deck sends her to the review, it does not
// hand her a retrieved deck.
await qa.goto('/deck', 'the reveal, while her CV review is still open');
await page.waitForURL(/\/review/, { timeout: 20000 }).catch(() => {});
await qa.scrollThrough('read the screen she gets instead of a deck');
const uncoveredDeck = await getJson('/onboarding/cards');
await qa.note(
  `the unearned reveal: at ${page.url()}, reviewPending=${uncoveredDeck?.reviewPending}, ` +
  `moreQuestions=${uncoveredDeck?.moreQuestions}, searching=${uncoveredDeck?.searching}`,
);
await assertTrue(
  page.url().includes('/review') && uncoveredDeck?.searching !== true,
  `she is sent to her CV review, not shown a spinner she can never get past — the refusal is a settled answer (${page.url()})`,
);

// =============================================================================================
// 3. SHE EARNS IT. She confirms her CV review, and nothing about the served half may have regressed.
// =============================================================================================
await qa.completeReview(); // #338: "Your CV, reviewed" confirmed — the one gate #339 left
const servedDeck = await callAsVisitor('GET', '/onboarding/cards');
await qa.note(`the same deck read, now that she has earned it: reviewPending ${servedDeck.json?.reviewPending}, retrieval ${JSON.stringify(servedDeck.json?.retrieval)?.slice(0, 160)}`);
await assertTrue(
  servedDeck.json?.reviewPending !== true && 'retrieval' in (servedDeck.json ?? {}),
  `the SAME read that was refused three times is no longer refused — the completed review is the only thing that changed`,
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
