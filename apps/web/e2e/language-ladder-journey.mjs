// #165/#308 — "a language and its level are two facts": the ladder, driven the way a person
// drives it. #308 moved the graded question off the swipe card into the TAILOR QUEUE — rungs and
// "Not now" intact — so this journey now proves the promise where the question actually lives.
//
// This is the inversion of language-withdrawal-journey.mjs (#123), which is now STALE: it asserts
// that leaving Mandarin unticked REMOVES the Mandarin-mandatory posting, which is exactly the harm
// #165 was written to delete. This journey proves the promise on the rendered screen:
//
//   front door -> discovery -> the floor -> work-rights -> THE LANGUAGES TYPE-AHEAD (a known word
//   completed from the list, and a word OFF the list kept in the person's own spelling, with
//   Mandarin and Cantonese deliberately LEFT OUT) -> sign in -> the deck, where
//     * the Mandarin-MANDATORY posting is STILL THERE (leaving a language out costs nothing),
//     * the deck card itself no longer asks anything (#308 — the ladder is retired off it),
//     * wanting the job lands the Tailor queue, where the graded question is asked with THIS
//       advert's own line as the reason and the cost said before the rungs,
//     * answering a rung BELOW the advert's bar closes the question and keeps the job,
//     * a language named only as a PLUS triggers the question too,
//     * "Not now" stores nothing: the same job never re-asks, the NEXT job that needs it does,
//     * and only the deliberately-tapped bottom rung ("I don't speak this one") ever removes a job.
//
//   PORT=34101 node apps/api/dist/qa-main.js          # fake model, readAd seam wired (#209)
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34190
//   BASE_URL=http://127.0.0.1:34190 node apps/web/e2e/language-ladder-journey.mjs
//
// ADVERT NOTE, up front, REWRITTEN 2026-08-13 (#209): apps/api/data/sample-postings.json carries NO
// language requirement of any kind — of the whole real corpus exactly one line mentions a language,
// as a preference — so the shipped corpus cannot produce either a withdrawal or a level question
// through this UI. It used to need a scratch fake API that was never checked in, which is why it ran
// in no tier and rotted. Three canned adverts now live in qa-main.ts and are served at the app's own
// pinned reader seam (BuildOptions.readAd), exactly as apps/api/test/cards.test.ts does — armed by
// this journey, for this run only (see setLanguageAdverts below). They are NOT in the shipped
// fixture corpus on purpose: writing fabricated requirements into real employers' adverts, quoted as
// those adverts' own words, on a corpus staging serves to visitors, is not a fixture.
// The VISITOR's side is never seeded — every language fact in this run is typed in the browser
// through the real routes. When those adverts are absent, the deck assertions self-skip with a note.
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.
import { createSession } from './qa-driver.mjs';
// #63: cards carry the id retrieval delivered, not the pool's own key - see live-ad-id.mjs.
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34190';
const ROLE = 'IT project manager in Hong Kong';
const MANDARIN_BLOCKING_AD = process.env.QA_MANDARIN_BLOCKING_AD ?? liveAdId('2026-07-05_okx_senior-strategy-project-manager-vip-institutions');
const CANTONESE_PLUS_AD = process.env.QA_CANTONESE_PLUS_AD ?? liveAdId('2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting');
const CANTONESE_BLOCKING_AD = process.env.QA_CANTONESE_BLOCKING_AD ?? liveAdId('2026-07-13_bnp-paribas_senior-project-manager');
const OFF_LIST_WORD = 'Wolof'; // #125's "French speaker in Asia": a real language the market list has never heard of

const qa = await createSession('language-ladder-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(12000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const txt = async (sel) => (await page.locator(sel).count())
  ? (await page.locator(sel).first().textContent()).trim() : null;
const askQ = () => txt('.discovery #ask-q, .discovery legend.q');
const eligDim = async () => (await page.locator('.discovery .opts').count())
  ? page.locator('.discovery .opts').first().getAttribute('data-elig') : null;
const deck = () => page.evaluate(async () => {
  const r = await fetch('/api/onboarding/cards', { credentials: 'include' });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return {
    ok: true,
    count: j.cards.length,
    ids: j.cards.map((c) => c.adId),
    // #308: the deck payload no longer carries a levelAsk — recorded here so a regression that
    // brings the card-side ask back goes red in this journey, not just in the API tests.
    cardsThatAsk: j.cards.filter((c) => c.levelAsk).map((c) => c.adId),
    withdrawn: j.withdrawn ?? null,
  };
});

// #209: arm qa-main.ts's canned language adverts for THIS run only, and put them back at the end.
// They are off by default because serving three extra adverts reshapes every OTHER journey's deck —
// measured: tailor-journey.mjs then tailors one of them.
//
// The arming is ASSERTED, not noted. The deck half below self-skips when the adverts are absent, so
// a silently-failed arm would leave this journey green while proving none of what it exists for —
// which is precisely the "a journey no tier runs is not coverage" failure #209 was opened to end,
// rebuilt one level down. A run that cannot arm the stack must go red.
const setLanguageAdverts = (on) =>
  page.evaluate(
    (languageAdverts) => fetch('/api/qa/stack', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ languageAdverts }),
    }).then((r) => r.status).catch(() => 'unreachable'),
    on,
  );

// -------------------------------------------------------------------------------------------
// 1. The front door.
// -------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
const armed = await setLanguageAdverts(true);
await qa.note(`armed the QA language adverts for this run: HTTP ${armed}`);
await assert(armed === 200, `the QA stack accepted the arming call (got ${armed}) — without it the deck half below proves nothing`);
await qa.scrollThrough('read the front door top to bottom');

// -------------------------------------------------------------------------------------------
// 2. Q1 — the role.
// -------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1: type the role');
await qa.click(page.getByRole('button', { name: "That's me" }), 'Q1: submit the role');
await page.waitForTimeout(1800);

// -------------------------------------------------------------------------------------------
// 3. The discovery floor, until the eligibility block opens.
// -------------------------------------------------------------------------------------------
let floorAnswered = 0;
for (let i = 0; i < 14; i++) {
  if (await eligDim()) break;
  const opt = page.locator('.discovery .opts .opt').first();
  if (await opt.count()) {
    const label = (await opt.textContent()).trim();
    await qa.click(opt, `floor answer ${i + 1}: "${label}"`);
  } else if (await page.locator('#floor-free').count()) {
    await qa.fill('#floor-free', 'Owned a $2M budget at Acme from 2021 to 2024', `floor answer ${i + 1}: typed`);
    await qa.click('.discovery .field .go', `floor answer ${i + 1}: Continue`);
  } else break;
  await page.waitForTimeout(2100);
  floorAnswered++;
  if (!page.url().includes('/discovery')) break;
}
await qa.note(`REGRESSION: answered ${floorAnswered} floor questions before the eligibility block opened`);

// -------------------------------------------------------------------------------------------
// 4. work-rights — the eligibility question #165 did not touch.
// -------------------------------------------------------------------------------------------
await assert((await eligDim()) === 'work-rights', `REGRESSION: work-rights is still asked (got "${await eligDim()}")`);
await qa.click(page.locator('.discovery .opts .opt').first(), 'answer work-rights with the first option');
await page.waitForTimeout(2300);

// -------------------------------------------------------------------------------------------
// 5. THE LANGUAGES QUESTION — a type-ahead now, not a tick-list. (#165 point 1 / AC1)
// -------------------------------------------------------------------------------------------
await page.waitForTimeout(600);
await qa.scrollThrough('read the languages question the way a hurried visitor would');
const langQ = await askQ();
const conseq = await txt('.discovery .conseq');
await qa.note(`question stem : ${JSON.stringify(langQ)}`);
await qa.note(`consequence   : ${JSON.stringify(conseq)}`);
await qa.expectVisible('.discovery .lang-typeahead #lang-input', 'AC1: the languages question is a TYPE-AHEAD input, not a checkbox list');

const oldBoxes = await page.locator('.discovery .opt.check input[type=checkbox]').count();
await assert(oldBoxes === 0, `the #123 tick-list is gone — ${oldBoxes} checkboxes on screen (the box whose unticked state wrote a hard "no")`);
await assert(!/unticked|treat as a no/i.test(langQ ?? ''),
  `the stem no longer threatens the visitor with a "no" it will infer — "${langQ}"`);
await assert(/still stays in your deck|nothing you leave out/i.test(conseq ?? ''),
  `AC2 said ON THE SCREEN, before the answer: leaving a language out costs nothing — "${conseq}"`);

// (a) a KNOWN word completes from the list.
await qa.fill('#lang-input', 'Eng', 'AC1: type three letters of a language on the list');
await page.waitForTimeout(700);
const engSuggestions = await page.locator('.discovery .sugg button').allTextContents();
await qa.note(`completions offered for "Eng": ${JSON.stringify(engSuggestions)}`);
await assert(engSuggestions.some((s) => s.trim() === 'English'), 'AC1: a known language COMPLETES from the list as the person types');
await qa.click(page.locator('.discovery .sugg button', { hasText: 'English' }).first(), 'tap the completion "English"');
await page.waitForTimeout(800);

// (b) the list really does know Mandarin — and this visitor still leaves it out. This is the whole
//     point of AC2: the omission below must cost her nothing.
await qa.fill('#lang-input', 'Man', 'type "Man" — proving Mandarin IS on the list…');
await page.waitForTimeout(700);
const manSuggestions = await page.locator('.discovery .sugg button').allTextContents();
await qa.note(`completions offered for "Man": ${JSON.stringify(manSuggestions)}`);
await assert(manSuggestions.some((s) => s.trim() === 'Mandarin'), 'the list offers Mandarin — so leaving it out below is a choice, not an impossibility');
await qa.fill('#lang-input', '', '…and clear it without adding: Mandarin is DELIBERATELY LEFT OUT');
await page.waitForTimeout(600);

// (c) a word OFF the list is KEPT in the person's own spelling.
await qa.fill('#lang-input', OFF_LIST_WORD, `AC1: type "${OFF_LIST_WORD}" — a language the market list has never heard of`);
await page.waitForTimeout(800);
const offListNote = await txt('.discovery .sugg .note');
await qa.note(`what the screen says about an unknown word: ${JSON.stringify(offListNote)}`);
await assert(offListNote !== null && offListNote.includes(OFF_LIST_WORD),
  `AC1: the unknown word is KEPT, not refused — the screen says so in the person's own spelling ("${offListNote}")`);
await qa.press('#lang-input', 'Enter', `press Enter to keep "${OFF_LIST_WORD}"`);
await page.waitForTimeout(800);
const chips = await page.locator('.discovery .chips .lbl').allTextContents();
await qa.note(`languages listed before confirming: ${JSON.stringify(chips)}`);
await assert(chips.map((c) => c.trim()).join('|') === `English|${OFF_LIST_WORD}`,
  `AC1: the list holds the completed word AND the off-list word, in her own spelling — ${JSON.stringify(chips)}`);
await qa.expectVisible(page.locator('.discovery .chips li').nth(1), `"${OFF_LIST_WORD}" sits in her list as a first-class entry, not a warning`);

const confirmLabel = await txt('.discovery .elig-actions .go');
await qa.note(`confirm button reads: ${JSON.stringify(confirmLabel)}`);
await qa.click('.discovery .elig-actions .go', 'confirm the languages answer — English and Wolof only, no Mandarin, no Cantonese');
await page.waitForTimeout(2400);
// The confirm may complete the question set and navigate straight on, so read what she is told
// without assuming the discovery screen is still mounted.
const lockedIn = await page.evaluate(() => (document.querySelector('.discovery') ?? document.body).innerText.replace(/\n+/g, ' | ').slice(0, 400));
await qa.note(`what she is told after confirming (at ${new URL(page.url()).pathname}): ${JSON.stringify(lockedIn)}`);

// -------------------------------------------------------------------------------------------
// 6. 🚨 THE HEADLINE PROMISE — leaving a language out removes NOTHING.
// -------------------------------------------------------------------------------------------
const afterAnswer = await deck();
await qa.note(`deck after the language answer: ${JSON.stringify(afterAnswer)}`);
const advertsPresent = afterAnswer.ok
  && afterAnswer.ids.includes(MANDARIN_BLOCKING_AD)
  && afterAnswer.ids.includes(CANTONESE_BLOCKING_AD);
await assert(afterAnswer.ok && afterAnswer.withdrawn && afterAnswer.withdrawn.total === 0,
  `AC2: after listing her languages WITHOUT Mandarin or Cantonese, nothing at all was withdrawn (${JSON.stringify(afterAnswer.withdrawn)})`);
await assert(advertsPresent,
  `AC2: both the Mandarin-MANDATORY and the Cantonese-MANDATORY postings are STILL IN HER DECK — the #123 harm is gone`);

if (!advertsPresent) {
  await qa.note('SKIPPING the deck half: the API is not serving the language adverts this journey needs (see the ADVERT NOTE at the top).');
} else {
  // -----------------------------------------------------------------------------------------
  // 7. Sign in and open the deck for real.
  // -----------------------------------------------------------------------------------------
  const signedIn = await page.evaluate(async () => {
    const email = `ladder-e2e-${Date.now()}@example.com`;
    const request = await fetch('/api/auth/request-link', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const result = await request.json().catch(() => ({}));
    if (!result.devLink) return { ok: false, status: request.status };
    const token = new URL('http://x' + result.devLink).searchParams.get('token');
    const verify = await fetch('/api/auth/verify', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    return { ok: verify.ok, status: verify.status };
  });
  await assert(signedIn.ok, `signed in before the reveal (${JSON.stringify(signedIn)})`);

  // Walk the deck, card by card, exactly as a person does, until the named advert is on screen.
  const openCard = async (adId, why) => {
    await qa.goto('/deck', `open the deck — ${why}`);
    const see = page.getByRole('button', { name: 'See them' });
    if (await see.count()) await qa.click(see, "press 'See them'");
    for (let i = 0; i < 20; i++) {
      const onScreen = await page.evaluate(() => document.querySelector('.jobcard h2')?.textContent?.trim() ?? null);
      const ids = (await deck()).ids ?? [];
      const idx = ids.indexOf(adId);
      const current = await page.evaluate(() => window.__qaCardIndex ?? null);
      await qa.note(`card ${i + 1} on screen: ${JSON.stringify(onScreen)} (looking for ${adId}, deck index ${idx}, ${current})`);
      if (await page.locator(`.jobcard [data-adid="${adId}"]`).count()) return true;
      const heading = onScreen ?? '';
      if (adId === MANDARIN_BLOCKING_AD && /VIP\/Institutions/i.test(heading)) return true;
      if (adId === CANTONESE_PLUS_AD && /Regulatory Reporting/i.test(heading)) return true;
      if (adId === CANTONESE_BLOCKING_AD && /^Senior Project Manager$/i.test(heading)) return true;
      const next = page.getByRole('button', { name: 'Not for me, show next job' });
      if (!(await next.count())) return false;
      await qa.click(next, `not this one — show the next job (looking for ${adId})`);
      await page.waitForTimeout(1200);
    }
    return false;
  };

  const foundMandarin = await openCard(MANDARIN_BLOCKING_AD, 'the Mandarin-mandatory posting she never listed Mandarin for');
  await assert(foundMandarin, 'AC2 ON THE SCREEN: the Mandarin-mandatory job is reachable in her deck, card by card');
  await qa.scrollThrough('read the whole card, top to bottom');

  // -----------------------------------------------------------------------------------------
  // 8. #308 — the card no longer asks. The question moved into the Tailor queue.
  // -----------------------------------------------------------------------------------------
  const cardLadders = await page.locator('.jcbody fieldset.ladder').count();
  await assert(cardLadders === 0,
    '#308: the deck card no longer asks the ladder — the graded question lives in the Tailor queue now');
  const deckPayload = await deck();
  await assert((deckPayload.cardsThatAsk ?? []).length === 0,
    `#308: no card in the payload carries a level ask either — ${JSON.stringify(deckPayload.cardsThatAsk)}`);

  const readAsk = () => page.evaluate(() => {
    const root = document.querySelector('.tailor .ask');
    if (!root) return null;
    const kids = [...root.children];
    return {
      q: root.querySelector('.q')?.textContent?.trim() ?? null,
      notices: [...root.querySelectorAll('.notice')].map((n) => n.textContent.trim()),
      cost: root.querySelector('.cost')?.textContent?.trim() ?? null,
      rungs: [...root.querySelectorAll('.opts .opt')].map((b) => b.textContent.trim()),
      skip: root.querySelector('.skip')?.textContent?.trim() ?? null,
      costBeforeRungs:
        kids.findIndex((k) => k.classList.contains('cost')) < kids.findIndex((k) => k.classList.contains('opts')),
      describedbyResolves: (() => {
        const db = root.querySelector('.opts')?.getAttribute('aria-describedby') ?? '';
        return db.length > 0 && db.split(/\s+/).every((id) => !!document.getElementById(id));
      })(),
    };
  });

  await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }),
    "press 'I want this one' — into the Tailor queue, the one place every question about a job is asked");
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await qa.expectVisible('.jobdeck.tailor', 'the Tailor step mounted');
  await page.waitForTimeout(900);

  // -----------------------------------------------------------------------------------------
  // 9. AC3 — the graded question, first in the queue, with this advert's own line as the reason.
  // -----------------------------------------------------------------------------------------
  const ladder = await readAsk();
  await qa.note(`the question as it renders: ${JSON.stringify(ladder, null, 1)}`);
  await assert(/Mandarin/.test(ladder?.q ?? ''), `AC3: the question names the language — "${ladder?.q}"`);
  await assert(ladder?.notices.some((n) => /Mandarin/.test(n) && /weekly reviews|"/.test(n)),
    `AC3: the reason is THIS ADVERT'S OWN LINE, quoted, not a generic explanation — ${JSON.stringify(ladder?.notices)}`);
  await assert(ladder?.notices.some((n) => /remember this for every job/i.test(n)),
    `the permanence is said BEFORE she answers — ${JSON.stringify(ladder?.notices)}`);
  await assert(ladder?.rungs.length === 6, `#125 decision 3: six rungs — ${JSON.stringify(ladder?.rungs)}`);
  await assert(!ladder?.rungs.some((r) => /\bB2\b|\bC1\b|fluent|native speaker|proficien/i.test(r)),
    'ADR-0003 clause 8a: every rung is a SITUATION a person can picture, never a code or an adjective');
  await assert(/don't speak this one/i.test(ladder?.rungs[ladder.rungs.length - 1] ?? ''),
    `the one answer that can cost her jobs sits LAST, where a distracted thumb does not land — ${JSON.stringify(ladder?.rungs)}`);
  await assert(/Only the last one takes jobs out/i.test(ladder?.cost ?? '') && ladder?.costBeforeRungs === true,
    `#125 decision 4: the cost is stated BEFORE the answer, never after — "${ladder?.cost}"`);
  await assert(/not now/i.test(ladder?.skip ?? ''), `ADR-0011 clause 4: the skip is "not now", not "stop asking" — "${ladder?.skip}"`);
  await assert(!ladder?.rungs.some((r) => /^(Yes|No)\b/.test(r)),
    '#308 AC4: a language answer is graded — the queue never offers a Yes/No about a language');
  await assert(ladder?.describedbyResolves === true,
    'a11y: the reason and the cost are announced with the rungs, as the deck ladder always did');

  // -----------------------------------------------------------------------------------------
  // 10. Answer a rung BELOW the advert's bar. It closes the question and keeps the job.
  // -----------------------------------------------------------------------------------------
  await qa.click(page.locator('.tailor .opts .opt', { hasText: 'I get by day to day' }).first(),
    "she places herself BELOW the advert's bar: 'I get by day to day'");
  await page.waitForTimeout(1600);
  const noted = await txt('.tailor .ledger');
  await qa.note(`what she is told after answering: ${JSON.stringify(noted)}`);
  await assert(/Remembered for Mandarin/i.test(noted ?? '') && /No job will ask you this again/i.test(noted ?? ''),
    `AC3: answering closes the question, and the screen says so — "${noted}"`);

  const belowBar = await deck();
  await qa.note(`deck after answering below the bar: ${JSON.stringify(belowBar)}`);
  await assert(belowBar.ids.includes(MANDARIN_BLOCKING_AD),
    'ADR-0003 clause 8a / #125 decision 5: being BELOW the bar never withdraws — the job is still there');

  await qa.goto('/tailor', 'reload the Tailor step as a returning visitor');
  await page.waitForTimeout(900);
  const reloaded = await readAsk();
  await assert(!/Mandarin/.test(reloaded?.q ?? ''),
    `AC3: the answer survives a reload — Mandarin is never asked again ("${reloaded?.q}")`);

  // -----------------------------------------------------------------------------------------
  // 11. A language named ONLY as a plus triggers the question too — and "Not now" stores nothing.
  // -----------------------------------------------------------------------------------------
  const foundPlus = await openCard(CANTONESE_PLUS_AD, 'the posting where Cantonese is only "an advantage"');
  await assert(foundPlus, 'the "Cantonese an advantage" card is reachable in her deck');
  await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }),
    'want the plus-only job — its queue must ask about Cantonese too');
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await page.waitForTimeout(900);
  const plusAsk = await readAsk();
  await qa.note(`the plus-only job's question: ${JSON.stringify(plusAsk, null, 1)}`);
  await assert(/Cantonese/.test(plusAsk?.q ?? ''),
    'AC3: a language named only as an ADVANTAGE triggers the question too — that is where a real level wins a job');
  await assert(plusAsk?.notices.some((n) => /Cantonese/.test(n) && /advantage/i.test(n)),
    `AC3: it quotes the advert's own "an advantage" line as the reason — ${JSON.stringify(plusAsk?.notices)}`);

  // #308 AC1/AC2/AC5 — the skip. Nothing is saved, THIS job stops asking, the NEXT job asks again.
  await qa.click(page.locator('.tailor .ask .skip'), "she is not sure — 'Not now'");
  await page.waitForTimeout(1600);
  const skippedLine = await txt('.tailor .ledger');
  await qa.note(`what she is told after skipping: ${JSON.stringify(skippedLine)}`);
  await assert(/Nothing saved/i.test(skippedLine ?? '') && /Cantonese/.test(skippedLine ?? ''),
    `#308: the skip says both halves out loud — nothing saved, and it will be asked again — "${skippedLine}"`);
  await qa.goto('/tailor', 'reload the same job — a skip must not nag on the job it was skipped on');
  await page.waitForTimeout(900);
  const afterSkip = await readAsk();
  await assert(!/Cantonese/.test(afterSkip?.q ?? ''),
    `ADR-0011 clause 4: never twice for the same advert — the reload does not re-ask ("${afterSkip?.q}")`);

  // -----------------------------------------------------------------------------------------
  // 12. The skipped question RETURNS on the next job that needs it — and the one answer that
  //     does remove a job is a deliberate tap on the bottom rung, nothing else.
  // -----------------------------------------------------------------------------------------
  // The card walk cannot pick this one out by eye: three fixture postings share the literal title
  // "Senior Project Manager" with it, and the deck renders no per-card id. Target it through the
  // same /want route the card's own button posts to (asked-once-journey's pattern) — its presence
  // in her deck was already asserted above (advertsPresent).
  const wantedBlocking = await page.evaluate(
    (id) => fetch(`/api/onboarding/cards/${encodeURIComponent(id)}/want`, { method: 'POST', credentials: 'include' })
      .then((r) => r.status),
    CANTONESE_BLOCKING_AD,
  );
  await assert(wantedBlocking === 200,
    `the Cantonese-mandatory job becomes the tailor target (HTTP ${wantedBlocking}) — the skipped question must come back here`);
  await qa.goto('/tailor', 'open the Tailor step for the Cantonese-mandatory job');
  await page.waitForTimeout(900);
  const returned = await readAsk();
  await assert(/Cantonese/.test(returned?.q ?? ''),
    `#308 AC2: not now meant not now — the NEXT job that needs Cantonese asks again ("${returned?.q}")`);

  await qa.click(page.locator('.tailor .opts .opt', { hasText: "I don't speak this one" }).first(),
    "she deliberately taps the bottom rung for Cantonese — the ONE answer with a cost");
  await page.waitForTimeout(1600);
  await qa.expectVisible(page.getByRole('heading', { name: 'Saved to your profile' }),
    'the answer is kept — the screen says so, and the job is honestly gone');
  // #309 AC3: the withdrawal names its reason, in the language's own terms, ABOVE the count.
  const goneReason = await txt('.jobdeck.tailor .loadstate .gone-reason');
  await qa.note(`the reason, named: ${JSON.stringify(goneReason)}`);
  await assert(/This job needs Cantonese/.test(goneReason ?? ''),
    `#309 AC3: the job that vanished because she just answered says why — "${goneReason}"`);
  const goneLine = await txt('.jobdeck.tailor .loadstate p:not(.gone-reason)');
  await qa.note(`the consequence, named: ${JSON.stringify(goneLine)}`);
  await assert(/Hidden 1 job that needs Cantonese/i.test(goneLine ?? ''),
    `the honest count, with the language named — "${goneLine}"`);
  await qa.click(page.getByRole('button', { name: 'Back to the deck' }), 'the one door off the gone screen');
  await page.waitForURL('**/deck', { timeout: 10_000 });

  const afterNo = await deck();
  await qa.note(`deck after the deliberate "I don't speak Cantonese": ${JSON.stringify(afterNo)}`);
  await assert(!afterNo.ids.includes(CANTONESE_BLOCKING_AD),
    'a CHOSEN removal still works: the Cantonese-MANDATORY posting is gone once she says she does not speak it');
  await assert(afterNo.ids.includes(CANTONESE_PLUS_AD),
    'and the posting where Cantonese was only an advantage STAYS — an ordinary requirement never removes a job');
  await qa.scrollThrough('read the deck she is left with');
}

// -------------------------------------------------------------------------------------------
// 13. Her profile shows both languages — including the one no list offered.
// -------------------------------------------------------------------------------------------
await qa.goto('/profile', 'open her profile');
await qa.scrollThrough('read the profile top to bottom');
// On a phone the facts live behind #192's pull-up sheet, collapsed by default. Pull it up — a
// language she cannot get to is not a language she has.
const grab = page.locator('.pfsheet-head .pfgrab');
if (await grab.count()) {
  await qa.click(grab, "pull up the 'Your facts' sheet, the way a person does on a phone");
  await page.waitForTimeout(1200);
}
await qa.scrollThrough('read her facts inside the sheet');
// The server payload is recorded BESIDE the rendered text on purpose: "the API said so" is not
// evidence that a person can see it, and when the two disagree the report has to say which half broke.
const profilePayload = await page.evaluate(async () => {
  const r = await fetch('/api/profile', { credentials: 'include' });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return {
    ok: true,
    factCount: j.factCount,
    langDomain: (j.domains ?? []).filter((d) => d.tag === 'lang').map((d) => d.facts.map((f) => f.text)),
    answer: j.languagesQuestion?.answer ?? null,
  };
});
await qa.note(`what the SERVER holds for her languages: ${JSON.stringify(profilePayload)}`);
const profileText = await page.evaluate(() => document.body.innerText);
await qa.note(`languages as her profile shows them: ${JSON.stringify((profileText.match(/[^\n]*(English|Wolof)[^\n]*/g) ?? []).slice(0, 6))}`);
await assert(profileText.includes(OFF_LIST_WORD),
  `AC1: the off-list language she typed is HERS — it shows on her own profile ("${OFF_LIST_WORD}")`);
await assert(profileText.includes('English'), 'the completed language shows on her profile too');

// #165 also opens the profile's own door to an off-list language — without it a French speaker
// could only ever REMOVE languages here, never add one.
const door = page.getByRole('button', { name: /Change your languages|languages/i }).first();
if (await door.count()) await qa.click(door, 'open the languages door on her profile');
await page.waitForTimeout(1000);
const addField = page.getByRole('textbox', { name: 'Add another language' });
await qa.expectVisible(addField, '#165: the profile door has a way IN for a language no suggestion offers');

await qa.note(`put the QA language adverts back for the journeys after this one: HTTP ${await setLanguageAdverts(false)}`);
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
