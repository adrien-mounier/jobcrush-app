// #23 Tailor (screen 3) — the full journey, human-paced, over a REAL stack.
//
// Unlike tailor.spec.ts / deck.spec.ts (which mock at the route layer), nothing here is stubbed:
// discovery -> reveal -> sign-in -> deck -> swipe right -> /tailor -> answer -> the ending -> the
// exits all run against the live Fastify API. No ANTHROPIC_API_KEY is needed — the whole flow is
// pure arithmetic over the E5 stub fixtures.
//
//   node apps/api/dist/main.js                    # API on :3001
//   pnpm --filter @jobcrush/web dev               # web on :3000
//   node apps/web/e2e/tailor-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `tailor-journey-${Date.now()}@example.com`;

const qa = await createSession('tailor-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

// The tailor screen is `fixed inset:0` with its own inner scroller, so window scrolling is a no-op —
// scroll `.live-wrap` the way a thumb would instead, and pause so lazy/scroll-triggered work shows.
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
  const label = await page.getByRole('img', { name: /% match/ }).getAttribute('aria-label');
  return Number(label.replace(/\D/g, ''));
};

// The requirement the current question is about. tailorQuestion() renders it as
// `This job wants: "<requirement>." Does that describe you?` — the sentence period is the template's,
// not the requirement's, so strip it or substring matches against the card rows miss.
const asking = async () =>
  ((await page.locator('.tailor .q').textContent()).match(/"([^"]+)"/)?.[1] ?? '').replace(/\.$/, '');

// Record a pass/fail into the report without aborting the run, so one defect never costs us the
// evidence for every later step. '' is always contained (pass); the sentinel never is (fail).
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);

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
// #339: the floor answers that used to give her deck its facts are gone — her read, reviewed CV
// does it now (a deck with no facts grades every requirement 0 and has no "Where you fit" to show).
// The named-denial ("You told me you don't have this") assertions ride on the tailor "No" in §6.
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
// 2. The reveal -> the deck card (also the /deck regression check: the card renderer moved to
//    jobcard.tsx this round, so the ring, the three lists and the folded ad must be unchanged).
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.expectVisible(page.getByRole('heading', { name: /matched you/ }), 'the reveal headline');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');

await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the score ring renders');
await qa.expectVisible(page.getByRole('heading', { name: 'Where you fit' }), 'DECK: "Where you fit"');
await qa.expectVisible(page.getByRole('heading', { name: "Where you don't — yet" }), 'DECK: "Where you don\'t — yet"');
// #311 (#287 c4): the recorded "no" is named only on a posting that asks for it in the denial's
// own words — the top deck card may honestly show nothing. Noted, not asserted; the tailor step
// below still proves the named-denial row on the ad whose own question was answered "No".
const deniedOnDeck = await page.getByRole('heading', { name: "You told me you don't have this" }).count();
await qa.note(`DECK: "You told me you don't have this" present on the top card = ${deniedOnDeck} (#311: named only where the posting asks)`);
await qa.expectVisible('details.ad', 'DECK: the ad is folded shut, last');
await qa.scrollThrough('read the deck card top to bottom');

await qa.note('DECK: the three mark glyphs are gold check / grey ? / dim dot — never a cross');
const deckMarks = await page.locator('.mk').allTextContents();
await qa.expectVisible(
  page.locator('body'),
  `DECK marks = ${JSON.stringify(deckMarks)} — no cross glyph present: ${!deckMarks.some((m) => /[✗✕×xX]/.test(m))}`,
);

// swipe left once (the deck's own control still works after the extraction), then back on to a card
await qa.click(page.getByRole('button', { name: 'Not for me, show next job' }), 'DECK: swipe left — next card');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the next card rendered');

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
// 4. AC4 — "I'm done — use this CV" is there at question one.
// ---------------------------------------------------------------------------------------------
await qa.expectVisible('.tailor .live-card h2', 'the job title heads the live card');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the score ring');
await qa.expectVisible('.tailor .q', 'the first question');
await qa.expectVisible(page.getByRole('button', { name: "I'm done — use this CV" }), 'AC4: the exit is available at question one');
await qa.expectVisible(page.getByRole('button', { name: 'Drop this job' }), 'Drop this job is available too');
await qa.expectText('.tailor .why', 'Answer and this card moves', 'the ask band names the payoff');
await readThrough('.live-wrap', 'read the whole card + the CV paper below it');

await qa.note('the three mark states on the live card');
const marks = await page.locator('.tailor .mk').allTextContents();
const hasCross = marks.some((m) => /[✗✕×]/.test(m));
await qa.expectVisible('.tailor .row.open .mk', `open rows carry a grey "?" — marks seen: ${JSON.stringify([...new Set(marks)])}, cross present: ${hasCross}`);

// ---------------------------------------------------------------------------------------------
// 5. AC1 + AC2 + AC3 — answer a gap "Yes": % climbs, the ? becomes a ✓, a ledger line lands,
//    the bubble's gap clause is rewritten, and the answer reaches the CV.
// ---------------------------------------------------------------------------------------------
const pctBefore = await pct();
const askedText = await asking();
const bubbleBefore = await page.locator('.tailor .bubble .gap').textContent();
await qa.note(`before: ${pctBefore}% · asking about "${askedText}" · bubble gap "${bubbleBefore}"`);
await qa.expectVisible(
  page.locator('.tailor .row.open').filter({ hasText: askedText }),
  `AC2: the asked requirement is a grey "?" row right now`,
);

await qa.click(page.getByRole('button', { name: 'Yes', exact: true }), 'answer "Yes" to the top gap');
await page.waitForTimeout(1400); // let the 680ms score tween + 640ms row flash play out

const pctAfter = await pct();
await qa.expectVisible(
  page.getByRole('img', { name: /% match/ }),
  `AC1: the visible % re-scored ${pctBefore}% -> ${pctAfter}% (climbed: ${pctAfter > pctBefore})`,
);
await qa.expectVisible(
  page.locator('.tailor .row.fit').filter({ hasText: askedText.replace(/^./, (c) => c.toLowerCase()) }),
  'AC2: the requirement moved into "Where you fit" with a gold check',
);
await qa.expectText('.tailor .ledger', '+', 'AC3: a ledger line landed naming the gain');
await qa.note(`AC3 ledger text: "${await page.locator('.tailor .ledger').textContent()}"`);

const bubbleAfter = await page.locator('.tailor .bubble .gap').textContent();
await qa.expectVisible(
  '.tailor .bubble',
  `AC2: the bubble's gap clause rewrote — "${bubbleBefore}" -> "${bubbleAfter}" (changed: ${bubbleAfter !== bubbleBefore})`,
);
await assert(bubbleAfter !== bubbleBefore, 'AC2: the bubble gap clause rewrote after a "Yes"');

await qa.expectVisible(
  page.locator('.tailor .cv').getByText(askedText.replace(/^./, (c) => c.toLowerCase()), { exact: false }),
  'the tailored answer reached the CV paper below the card',
);
await readThrough('.live-wrap', 'scroll down to see the new line on the CV');

// ---------------------------------------------------------------------------------------------
// 6. A "No" answer: leaves the open list, lands once under "You told me you don't have this" (#311),
//    and the bubble must stop naming it.
// ---------------------------------------------------------------------------------------------
const noAsked = await asking();
const bubbleBeforeNo = await page.locator('.tailor .bubble .gap').textContent();
await qa.click(page.getByRole('button', { name: 'No', exact: true }), `answer "No" to "${noAsked}"`);
await page.waitForTimeout(1400);

await qa.expectVisible(
  page.locator('.tailor .row.settled').filter({ hasText: noAsked }),
  `a "No" lands under "You told me you don't have this" as a dim dot — never a cross`,
);
const openCount = await page.locator('.tailor .row.open').filter({ hasText: noAsked }).count();
const settledCount = await page.locator('.tailor .row.settled').filter({ hasText: noAsked }).count();
await qa.expectVisible(
  '.tailor .flat',
  `the declined requirement appears once, not twice — open rows: ${openCount}, settled rows: ${settledCount}`,
);
await assert(
  openCount === 0 && settledCount === 1,
  `the declined requirement is listed exactly once (open rows=${openCount}, settled rows=${settledCount})`,
);

const bubbleAfterNo = await page.locator('.tailor .bubble .gap').textContent();
await qa.expectVisible(
  '.tailor .bubble',
  `the bubble must stop naming a declined requirement — was "${bubbleBeforeNo}", now "${bubbleAfterNo}"`,
);
// DEFECT #23-1: the tailor route filters `dontYet` for negatives but takes card.bubble straight from
// buildJobCard, whose pickOpenClause is not negative-aware — so the headline keeps pointing at the
// requirement the visitor just declined. This assertion goes green when that is fixed.
await assert(
  bubbleAfterNo !== noAsked,
  `AC2: the bubble stopped naming the declined requirement (still headlining it: ${bubbleAfterNo === noAsked})`,
);

await qa.expectText('.tailor .ledger', 'asked and closed', 'AC3: the "No" ledger line records the open count');
await qa.note(`ledger after the "No": "${await page.locator('.tailor .ledger').textContent()}"`);

// ---------------------------------------------------------------------------------------------
// 7. Reload mid-flow — the %, the ledger's effect on the lists, and never-re-ask must all survive.
// ---------------------------------------------------------------------------------------------
const pctPreReload = await pct();
const qPreReload = await page.locator('.tailor .q').textContent();
await qa.goto('/tailor', 'reload mid-flow');
await page.waitForTimeout(900);
const pctPostReload = await pct();
await qa.expectVisible(
  page.getByRole('img', { name: /% match/ }),
  `the % survived the reload: ${pctPreReload}% -> ${pctPostReload}% (held: ${pctPostReload >= pctPreReload})`,
);
await assert(pctPostReload >= pctPreReload, `AC1: the % held across a reload (${pctPreReload}% -> ${pctPostReload}%)`);
await qa.expectText('.tailor .q', qPreReload.match(/"([^"]+)"/)[1], 'the already-answered questions stayed unasked');
await qa.expectVisible('.tailor .ledger', 'the ledger slot is reserved but empty on a resume — no stale line replayed');

// ---------------------------------------------------------------------------------------------
// 8. AC5 — exhaust every question; the flow stops on the ending by itself.
// ---------------------------------------------------------------------------------------------
await qa.note('answer the rest, watching the % climb — the flow must land the ending on its own');
const climb = [await pct()];
for (let i = 0; i < 12 && (await page.locator('.tailor .opts .opt').count()) > 0; i++) {
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.waitForTimeout(1100);
  climb.push(await pct());
}
await qa.note(`AC1: the % sequence across the whole flow — ${climb.join('% -> ')}%`);
const monotonic = climb.every((v, i) => i === 0 || v >= climb[i - 1]);
await qa.expectVisible('.tailor .live-card', `AC1: the % never decreased at any step (monotonic: ${monotonic})`);
await assert(monotonic, `AC1: the visible % never decreased across the whole flow (${climb.join('% -> ')}%)`);

await qa.expectVisible(
  page.getByRole('heading', { name: 'This CV is as strong as I can make it for this job.' }),
  'AC5: running out of questions lands the ending on its own',
);
await qa.expectVisible('.tailor .finish .note', 'AC6: the closed-gaps line');
await qa.note(`AC6 closed-gaps line: "${await page.locator('.tailor .finish .note').textContent()}"`);
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), 'AC6/#313: the one approve-is-send press (primary)');
await qa.expectVisible(page.getByRole('button', { name: 'Save it and come back later' }), 'AC6: Save (secondary)');
await qa.expectVisible(page.getByRole('button', { name: 'Drop this job' }), 'AC6: Drop is available');
// Spec §5: at the ending the exits row holds only Drop — "I'm done" served its purpose getting here.
const doneStillThere = await page.getByRole('button', { name: "I'm done — use this CV" }).count();
await assert(doneStillThere === 0, `spec §5: only Drop remains in the exits at the ending ("I'm done" count: ${doneStillThere})`);

await readThrough('.live-wrap', 'read the finished CV — every answer should be on it');

// ---------------------------------------------------------------------------------------------
// 9. AC6 — Drop, with the reassurance, and the facts survive it.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'Drop this job' }), 'AC6: Drop this job');
await qa.expectText(
  '.tailor .exits.confirming .notice',
  'Everything you told me stays on your profile.',
  'AC6: the reassurance copy, verbatim',
);
await qa.click(page.getByRole('button', { name: 'Keep it' }), 'Keep it — the job is not dropped');
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), 'still on the ending after Keep it');

// #313 removed the Apply holding beat: approving IS sending, and the press itself is
// approve-is-send-journey.mjs's job. Here the ending just carries the one press (asserted above).
const factsBefore = await page.locator('.tailor .cv .cv-line').count();
await qa.click(page.getByRole('button', { name: 'Save it and come back later' }), 'AC6: Save it and come back later (secondary)');
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
  `AC6: "everything you told me stays on your profile" — after the drop the profile still holds ` +
    `${profile.factCount} facts / ${profile.cvLines} CV lines (card showed ${factsBefore} lines before the drop)`,
);

// ---------------------------------------------------------------------------------------------
// 10. AC5 — the OTHER way into the ending: press "I'm done" at question one, on a fresh job.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'pick a second job to reach the ending the early way');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
// The job just dropped is still the top card and every one of its requirements is already answered —
// swipe past it, or /tailor lands straight on the ending with no question one to press through.
await qa.click(page.getByRole('button', { name: 'Not for me, show next job' }), 'swipe past the job already tailored');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right on a fresh job');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(800);

await qa.expectVisible('.tailor .q', 'question one, nothing answered on this job yet');
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), 'AC5: press "I\'m done" at question one');
await qa.expectVisible(
  page.getByRole('heading', { name: 'This CV is as strong as I can make it for this job.' }),
  'AC5: the identical ending — same heading, no "you stopped early" variant',
);
await qa.expectVisible(page.getByRole('button', { name: 'Approve and email me this CV' }), 'AC6/#313: the approve press, same as the exhausted ending');
await qa.expectVisible(page.getByRole('button', { name: 'Save it and come back later' }), 'AC6: Save, same as the exhausted ending');
await qa.note(`the early ending's closed-gaps line: "${await page.locator('.tailor .finish .note').textContent()}"`);

const stoppedEarly = await page.getByText(/stopped early/i).count();
await qa.expectVisible('.tailor .finish', `AC5: both endings are identical — no "stopped early" copy (found ${stoppedEarly})`);

// ---------------------------------------------------------------------------------------------
// 11. Keyboard-only + reduced motion.
// ---------------------------------------------------------------------------------------------
await qa.note('keyboard-only: tab to the exits and drive Drop from the keyboard');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await qa.note(`focus after two tabs from the ending: "${focused}"`);

await qa.click(page.getByRole('button', { name: 'Drop this job' }), 'open the drop confirm');
const confirmFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await qa.note(`focus moves to "${confirmFocus}" inside the drop confirm`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const escFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '(none)');
await qa.expectVisible(
  page.getByRole('button', { name: 'Drop this job' }),
  `Esc keeps the job and returns focus to "${escFocus}"`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
