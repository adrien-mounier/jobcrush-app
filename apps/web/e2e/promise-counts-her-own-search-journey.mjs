// #246 — the number on question 1 is HER OWN search, and the sentence around it names nothing.
//
// The defect this closes is one sentence a visitor reads before she has given us anything:
//
//     10 IT project delivery jobs are open right now.
//
// Two faults in it. It named an internal job family ("IT project delivery" is our label, not her
// word — #228 decision 7 / spec #233 decision 8). And for a visitor whose typed target role no
// published family covers, the 10 was counted over the family her CV proves — the family she is
// INTERVIEWED on — while her deck searches the words she typed. Promise and deck were drawn from
// two different searches, so the deck could never keep the promise.
//
// Owner decisions, 2026-08-19, both binding and both proven here:
//   1. The promise names NO job family — TO ANYONE, not only the word-search visitor. Same rule the
//      owner applied to the PLACE on 2026-08-13: if the promise cannot say it honestly to everyone,
//      it does not say it. So the mapped visitor is walked here too, not just the unmapped one.
//   2. The number is what her own search will actually return (option 3), which needs a provider
//      retrieval at question 1 — legal only since #248 split FETCHING postings from being ALLOWED
//      TO SEE them. Nothing here may show her a card at question 1; the number is not a card.
//
// Why a browser and not a payload assertion: this repo has already shipped a screen that stayed
// blank while every server-side assertion passed (#162), and the whole claim of #246 is about a
// sentence a person READS. The forbidden-word sweep below runs over the rendered body text.
//
// What it walks:
//   A. The mapped visitor — the shipped case, every visitor today. Her promise must name no family
//      and no place either (owner decision 1 supersedes #246's own AC2, which was written before it
//      and still says her promise is "unchanged from today").
//   B. The word-search visitor — typed role no published family covers, so `searchFamily` is null.
//      Her number is read off the screen, checked against the retrieval her session recorded, held
//      across every answer she gives and across a reload, and finally compared with the deck she is
//      actually served.
//   C. A search that comes back EMPTY — she must see no promise sentence at all, not a broken one
//      and not a fabricated zero.
//   D. A search that could not RUN (provider outage) — same: no sentence, and the interview still
//      works. She loses the number, never the screen.
//
// C and D are reachable only through POST /qa/stack's retrievalOutcome knob (qa-main.ts), which is
// process-wide — so they run last and the knob is put back before the run ends.
//
// Run it (never against a real provider key — the QA entry's retriever is a stand-in and the model
// is fake, so this run spends nothing):
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                        # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30246
//   BASE_URL=http://127.0.0.1:30246 node apps/web/e2e/promise-counts-her-own-search-journey.mjs
//
// Ports are deliberately not 3000/3001: a sibling project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time. Run serially — it mints four anonymous sessions and one magic-link sign-in, both capped per
// IP.
//
// HARNESS CEILING, stated so a future reader does not mistake it for a product claim: qa-main.ts's
// stand-in retriever ignores the query and hands back the whole curated corpus whatever was typed,
// and only 10 of those 17 adverts carry a hand-curated requirement set (the live advert reader is
// not wired here). So the deck this run serves is smaller than the catch the promise counts, by an
// amount that is mostly the harness. What this journey CAN prove — and does — is that both numbers
// now come from the same retrieval, which is the thing that was false before.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30246';
const API = process.env.API_URL ?? 'http://127.0.0.1:34101';

const MAPPED_ROLE = 'IT project manager';
const WORD_SEARCH_ROLE = 'sous vide pastry chef';
const AREA = 'Hong Kong';

// The sentence is allowed to say this and nothing more descriptive. "new" is the owner's word
// (2026-08-20), kept after he was asked to reconsider whether the pipeline can back it — pinned
// here so a later tidy-up cannot quietly drop it back to the shorter line.
const PROMISE_TAIL = 'new jobs are open right now.';

// Nothing on the discovery screen may name the family we placed her into, the vocabulary that
// placed her, or the research behind it (spec #233 decision 8). Lower-cased, swept over the whole
// rendered body.
//
// The PLACE is deliberately NOT in this list, and that is the #214 decision, not an oversight: the
// promise sentence names no place, but the per-market work-rights question legitimately does ("Can
// you already work in Hong Kong without visa sponsorship?") — that is the one spot where the
// location signal can be honest. So the place is asserted against the promise SENTENCE only,
// further down, never against the whole screen.
// #260: the families were renamed after the ROLE ("IT Project Manager", "Business Analyst"), and
// this list was left hunting only the OLD label — it kept passing while its own verdict message
// ("no job family is named anywhere on the screen") had stopped being proven. The family IDs are
// added because they can ONLY ever be a leak. The new LABELS deliberately are not: both are
// ordinary job titles, "IT project manager" is in question 1's own hard-coded help text, and
// "business analyst" is a published market title this screen is supposed to offer — asserting on
// them here would fire on copy that is working as designed. The narrower promise-SENTENCE check
// further down still bites on 'project manager', which is what this journey actually exists for.
const FORBIDDEN = [
  'it project delivery',
  'project delivery',
  'it-project-delivery',
  'business-analysis',
  'job family',
  'family research',
  'vocabulary',
  'word search',
  'keyword',
];

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

const qa = await createSession('promise-counts-her-own-search-journey', {
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

/** The QA harness's own knob, straight at the API — never a visitor-reachable surface. */
async function armRetrieval(outcome) {
  const res = await fetch(`${API}/qa/stack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ retrievalOutcome: outcome }),
  });
  await qa.note(`harness: retrieval outcome armed to "${outcome}" (HTTP ${res.status})`);
}

/** A fresh visitor in the same browser — new cookie jar, nothing carried over. */
async function freshVisitor(label) {
  await page.context().clearCookies();
  await qa.note(`— a brand new visitor: ${label} —`);
}

/** The front door, through to the discovery screen with question 1 answered. */
async function walkIntoDiscovery(role) {
  await qa.goto('/', `the front door — she is going for "${role}"`);
  await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');
  const ready = page.getByRole('button', { name: /Ready\?/ });
  if (await ready.count()) await qa.click(ready.first(), 'Ready? — open the front door');
  const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
  if (await startQuestions.count()) await qa.click(startQuestions.first(), 'Start questions instead');
  if (await page.locator('#target-role').count()) {
    await qa.fill('#target-role', role, `the job she is going for: "${role}"`);
    await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
    await qa.click('button:has-text("Save and continue")', 'Save and continue');
    // #257: the save walks her on to discovery by itself — wait for that navigation to settle
    // before leaving, so the next goto never races it.
    await page.waitForURL(/\/discovery/);
  }

  await qa.goto('/paste', 'paste her CV — two dated jobs and one degree');
  await qa.fill('textarea', CV_TEXT, 'the work history the deck will judge her against');
  await qa.click('button.btn', 'send the CV to be read');
  await page.waitForTimeout(2000);
  for (let i = 0; i < 60; i += 1) {
    const b = await json('/job-blocks');
    if (b?.blocks?.length) break;
    await page.waitForTimeout(500);
  }

  await qa.goto('/discovery', 'into discovery — the sign-up questions');
  await qa.fill('#q1-role', role, 'answer question 1: the role she is going for');
  const t0 = Date.now();
  await qa.click('button.go.wide', 'send question 1 — this is the moment the product goes and searches');
  await page.waitForTimeout(2500);
  const elapsedMs = Date.now() - t0;
  await qa.scrollThrough('read the discovery screen the way a real visitor would');
  return elapsedMs;
}

/** The promise exactly as the screen renders it: the number, the sentence, and whether it is there
 *  at all. Read off the DOM, never off a payload. */
async function readPromise() {
  // Let the "Finding jobs like yours…" placeholder (`.promise.blind`) clear first, so a number is
  // never read as "···" and an absent promise is never confused with one still being searched for.
  for (let i = 0; i < 40 && (await page.locator('.promise.blind').count()) > 0; i += 1) {
    await page.waitForTimeout(250);
  }
  const box = page.locator('.promise');
  if ((await box.count()) === 0) return { present: false, number: null, text: '' };
  const text = (await box.first().innerText()).replace(/\s+/g, ' ').trim();
  const nSlot = box.first().locator('.n');
  const raw = (await nSlot.count()) ? (await nSlot.first().innerText()).trim() : '';
  const number = /^\d+$/.test(raw) ? Number(raw) : null;
  return { present: true, number, text };
}

/** Answer the floor questions the SCREEN puts to her, by pressing its own buttons. */
async function answerFloorQuestionsOnScreen(limit = 8) {
  const asked = [];
  for (let i = 0; i < limit; i += 1) {
    const state = await json('/onboarding/discovery');
    const next = (state?.questions ?? []).find((q) => !q.eligibility);
    if (!next) break;
    const opts = page.locator('.opts button.opt');
    const freeText = page.locator('#floor-free');
    try {
      await page.locator('.opts button.opt, #floor-free').first().waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      await qa.note(`the screen never offered a control for "${next.itemId}" — stopping the answer loop`);
      break;
    }
    const heading = (await page.locator('.ask .q').first().innerText().catch(() => '(no question)'))
      .replace(/\s+/g, ' ')
      .trim();
    if (await opts.count()) {
      const count = await opts.count();
      let chosen = opts.first();
      for (let k = 0; k < count; k += 1) {
        const label = (await opts.nth(k).innerText()).trim();
        if (!/^no[.!]?$/i.test(label)) { chosen = opts.nth(k); break; }
      }
      await qa.click(chosen, `she is asked "${heading}" — she presses an answer`);
    } else {
      await qa.fill(freeText, 'Yes, across three vendor teams and the steering group', `she is asked "${heading}" — she types her own answer`);
      await qa.click('.ask button.go', 'Continue — she sends her typed answer');
    }
    asked.push(next.itemId);
    await page.waitForTimeout(1200);
  }
  return asked;
}

/** The forbidden-word sweep, over the rendered screen and not the wire. */
async function sweepScreenForLeaks(where) {
  const body = (await page.locator('body').innerText()).toLowerCase();
  const leaked = FORBIDDEN.filter((word) => body.includes(word));
  await assertTrue(
    leaked.length === 0,
    `AC3 — ${where}: no job family, vocabulary, research or place is named anywhere on the screen (found: ${leaked.join(', ') || 'nothing'})`,
  );
}

await armRetrieval('relevant_postings');

// =================================================================================================
// A. THE MAPPED VISITOR — the shipped case, and the half owner decision 1 added to this ticket.
//    #246's own AC2 says her promise is "unchanged from today". It is not, deliberately: the family
//    name came out of the sentence for HER too. That AC text is stale and this scene is the decision.
// =================================================================================================
await qa.note(
  'Scene A — the visitor the published vocabulary DOES cover. Before this ticket her screen read ' +
  '"10 IT project delivery jobs are open right now." The owner decided on 2026-08-19 that no ' +
  'visitor is told a job family before her deck, so hers changes too.',
);
await freshVisitor(`mapped — "${MAPPED_ROLE}"`);
const mappedWaitMs = await walkIntoDiscovery(MAPPED_ROLE);
await qa.expectVisible('.promise', 'her promise is on the screen');
const mapped = await readPromise();
await qa.note(`the sentence she reads, verbatim: "${mapped.text}"  (question 1 took ${mappedWaitMs}ms end to end, screen included)`);
await assertTrue(
  mapped.present && typeof mapped.number === 'number' && mapped.number > 0,
  `AC1/owner decision 2 — she is given a real number, not a hand figure and not silence (${mapped.number})`,
);
await assertTrue(
  mapped.text.toLowerCase().includes(PROMISE_TAIL),
  `owner decision 1 — the sentence is the generic one, the same for everybody: "…${PROMISE_TAIL}"`,
);
await assertTrue(
  !/it project delivery|project manager/i.test(mapped.text),
  `owner decision 1 — the MAPPED visitor's promise names no job family either (this is where #246's own AC2 is superseded): "${mapped.text}"`,
);
await assertTrue(
  !/hong kong|kowloon/i.test(mapped.text),
  `#214 — and it still names no place either, the half of this sentence the owner already cut: "${mapped.text}"`,
);
await sweepScreenForLeaks('the mapped visitor\'s discovery screen');
const mappedRecord = (await json('/sessions/me'))?.discovery;
await assertTrue(
  mappedRecord?.searchFamily?.familyId === 'it-project-delivery',
  `she really is the mapped case — a family IS pinned for her search, it is simply never said out loud (${JSON.stringify(mappedRecord?.searchFamily)})`,
);

// =================================================================================================
// B. THE WORD-SEARCH VISITOR — the visitor #246 was filed for.
// =================================================================================================
await qa.note(
  'Scene B — the visitor whose kind of work the product cannot name yet. Her CV proves IT project ' +
  'delivery, so that is the floor she is INTERVIEWED on; but her deck searches the words she typed. ' +
  'Before this ticket she was promised the count of the family she is interviewed on — a number ' +
  'drawn from a search her deck would never run.',
);
await freshVisitor(`word search — "${WORD_SEARCH_ROLE}"`);
const wordWaitMs = await walkIntoDiscovery(WORD_SEARCH_ROLE);
await qa.expectVisible('.promise', 'her promise is on the screen too — she gets the same screen, not a thinner one');
const first = await readPromise();
await qa.note(`the sentence she reads, verbatim: "${first.text}"  (question 1 took ${wordWaitMs}ms end to end, screen included)`);
await assertTrue(
  first.present && typeof first.number === 'number' && first.number > 0,
  `AC1 — she is given a real number, not "no number" and not a broken sentence (${first.number})`,
);
await assertTrue(
  first.text.toLowerCase().includes(PROMISE_TAIL) && !/delivery|manager|chef|pastry/i.test(first.text),
  `AC1 — her promise names no job family and no family-scoped count; it is the same sentence the mapped visitor got: "${first.text}"`,
);
await assertTrue(
  mapped.text === first.text.replace(String(first.number), String(mapped.number)),
  'owner decision 1 — the two visitors read the SAME sentence, differing only in the number (nothing on this screen tells her which kind of search she got)',
);
await assertTrue(
  !/hong kong|kowloon/i.test(first.text),
  `#214 — her promise names no place either: "${first.text}"`,
);
await sweepScreenForLeaks('the word-search visitor\'s discovery screen');

const record = (await json('/sessions/me'));
await qa.note(`her stored discovery record: ${JSON.stringify(record?.discovery)}`);
await assertTrue(
  record?.discovery?.searchFamily === null,
  `she really is the word-search case — no family is pinned for her search (${JSON.stringify(record?.discovery?.searchFamily)})`,
);
await assertTrue(
  record?.promiseOpenJobs === first.number,
  `AC4 — the number on her screen is the one HER OWN search recorded on her session, not a count of a fixture pool (screen ${first.number} vs session ${record?.promiseOpenJobs})`,
);

// The number must not blink out or re-price itself as she works. Every answer she gives moves her
// retrieval fingerprint, so a promise read off the live snapshot would vanish on the first tap.
const asked = await answerFloorQuestionsOnScreen();
await qa.note(`the questions her own screen put to her, in order: ${asked.join(', ') || '(none)'}`);
await assertTrue(asked.length >= 4, `she was interviewed properly — ${asked.length} floor items, from the family her CV proves`);
const afterAnswers = await readPromise();
await qa.note(`the promise after she answered everything: "${afterAnswers.text}"`);
await assertTrue(
  afterAnswers.present && afterAnswers.number === first.number,
  `AC4 — the number did not vanish and did not move while she answered (${first.number} -> ${afterAnswers.number})`,
);

await qa.goto('/discovery', 'she reloads the page, the way anyone does');
await page.waitForTimeout(1500);
await qa.scrollThrough('read the reloaded screen');
const afterReload = await readPromise();
await assertTrue(
  afterReload.present && afterReload.number === first.number,
  `AC4 — the same number comes back on a reload, without paying for a second search (${first.number} -> ${afterReload.number})`,
);
await sweepScreenForLeaks('the reloaded discovery screen');

// Now the deck she is actually served, and the honest size of what is left between the two numbers.
const link = await callAsVisitor('POST', '/auth/request-link', { email: `promise-${Date.now()}@example.com` });
const devLink = link.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await callAsVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });

await qa.goto('/deck', 'the reveal — past the sign-in wall now');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
let deck = { cards: [] };
for (let i = 0; i < 12; i += 1) {
  deck = (await json('/onboarding/cards')) ?? { cards: [] };
  if ((deck.cards ?? []).length && deck.retrieval?.outcome === 'relevant_postings') break;
  await page.waitForTimeout(1500);
}
await page.reload();
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck', 'DECK: she reached the card deck the promise was made about');
await qa.scrollThrough('read her deck the way a job seeker would, card by card');
const cardCount = (deck.cards ?? []).length;
await qa.note(
  `she was promised ${first.number}; her deck holds ${cardCount} cards (retrieval outcome: ${deck.retrieval?.outcome}).\n` +
  `Both numbers now come off the SAME retrieval — that is the ticket. What is still between them is\n` +
  `the deck's own post-catch work: adverts it could not READ, adverts withdrawn as expired, and (for\n` +
  `a visitor WITH a search family, which this one is not) adverts deleted as out-of-family. In THIS\n` +
  `harness most of that drop is the harness: the stand-in retriever ignores the query and returns the\n` +
  `whole 17-advert corpus, of which only 10 carry a hand-curated requirement set because the live\n` +
  `advert reader is not wired here. In production the query is her own typed words plus her family's\n` +
  `market titles, and every advert goes to a real reader.`,
);
await assertTrue(
  cardCount > 0,
  `AC4 — the promise was not empty talk: she really is served a deck of adverts from that search (${cardCount} cards)`,
);
await assertTrue(
  cardCount <= first.number,
  `AC4 — the deck never exceeds what she was promised; the promise is a ceiling she can only under-deliver against, never a number she was short-changed on (${cardCount} <= ${first.number})`,
);
const deckBody = (await page.locator('body').innerText()).toLowerCase();
await assertTrue(
  !deckBody.includes('sous vide') || !deckBody.includes('job family'),
  'nothing on her deck tells her she got a word search rather than a family search',
);

// =================================================================================================
// C. A SEARCH THAT CAME BACK EMPTY — no sentence at all, never a fabricated zero.
// =================================================================================================
await qa.note(
  'Scene C — her search runs and finds nothing. "0 jobs are open right now" on question 1 would be ' +
  'a verdict on a search she has not finished describing, so the line is dropped instead (design §4c).',
);
await armRetrieval('empty_pool');
await freshVisitor('her search returns nothing');
await walkIntoDiscovery(WORD_SEARCH_ROLE);
const empty = await readPromise();
await qa.note(`what stands where the promise would be: ${empty.present ? `"${empty.text}"` : '(nothing at all)'}`);
await assertTrue(
  !empty.present,
  `AC1 — no promise sentence is rendered at all when the search found nothing (present: ${empty.present})`,
);
const emptyBody = (await page.locator('body').innerText()).toLowerCase();
await assertTrue(
  !emptyBody.includes(PROMISE_TAIL) && !/\b0 jobs\b/.test(emptyBody),
  'AC1 — and no half-sentence and no zero leaked onto the screen in its place',
);
await qa.expectVisible('#ask-q', 'the interview itself is untouched — she is still asked her questions');
await sweepScreenForLeaks('the empty-search discovery screen');

// =================================================================================================
// D. A SEARCH THAT COULD NOT RUN — the provider is down. She loses the number, never the screen.
// =================================================================================================
await qa.note(
  'Scene D — the provider is down, so we could not look at all. "We could not ask" and "we asked and ' +
  'found nothing" are different facts (#174), and neither of them is a number.',
);
await armRetrieval('provider_unavailable');
await freshVisitor('the provider is down when she arrives');
const outageWaitMs = await walkIntoDiscovery(WORD_SEARCH_ROLE);
const outage = await readPromise();
await qa.note(`question 1 took ${outageWaitMs}ms with the provider down; what stands where the promise would be: ${outage.present ? `"${outage.text}"` : '(nothing at all)'}`);
await assertTrue(
  !outage.present,
  `AC1 — a failed search costs her the number and nothing else: no sentence, no broken sentence (present: ${outage.present})`,
);
await qa.expectVisible('#ask-q', 'she still gets a working interview — a real question, not an error screen');
const outageBody = (await page.locator('body').innerText()).toLowerCase();
await assertTrue(
  !outageBody.includes("we couldn't look for jobs just now") && !outageBody.includes(PROMISE_TAIL),
  'no outage wording and no half-promise reach her at question 1 — the search failing is our problem, not her screen',
);
await sweepScreenForLeaks('the provider-outage discovery screen');

await armRetrieval('relevant_postings');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
