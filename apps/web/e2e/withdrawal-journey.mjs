// #107 (E5 slice 6) — "a job you genuinely cannot take leaves your deck", driven as a human.
//
// Front door -> discovery -> the eligibility block (the LANGUAGES multi-select in particular) ->
// a reload that must not re-ask -> the deck -> the tailor
// screen. Nothing is stubbed: this rides the live Fastify API and a real Next build.
//
//   PORT=30181 node apps/api/dist/main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/withdrawal-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.
//
// COVERAGE NOTE, stated up front rather than implied: apps/api/data/sample-ad-requirements.json
// contains NO `kind: "blocking"` requirement and no language-dimension requirement at all. A real
// withdrawal therefore cannot be produced through this UI without inventing product data, so this
// journey proves the SURROUNDING flow is intact (the language question still asked, answered,
// closed, and not re-asked after the scope change; the deck still assembles; tailor still opens)
// and leaves the withdrawal itself to the API-boundary tests in apps/api/test/cards.test.ts.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const ROLE = 'IT project manager in Singapore';

const qa = await createSession('withdrawal-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(12000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const txt = async (sel) => (await page.locator(sel).count())
  ? (await page.locator(sel).first().textContent()).trim() : null;
const askQ = () => txt('.discovery #ask-q, .discovery legend.q');
const optLabels = () => page.locator('.discovery .opts .opt').allTextContents();
const eligDim = async () => {
  const dim = (await page.locator('.discovery .opts[data-elig]').count())
    ? await page.locator('.discovery .opts[data-elig]').first().getAttribute('data-elig')
    : null;
  return dim ?? ((await page.locator('.discovery fieldset.elig-group').count()) ? 'language' : null);
};

// ---------------------------------------------------------------------------------------------
// 1. The front door.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom');

// ---------------------------------------------------------------------------------------------
// 2. Q1 — the role.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1: type the role');
await qa.click(page.getByRole('button', { name: "That's me" }), "Q1: submit the role");
await page.waitForTimeout(1800);
await qa.expectVisible('.discovery .countdown', 'the countdown appears with the first question');

// ---------------------------------------------------------------------------------------------
// 3. Walk the discovery floor until the eligibility block opens.
// ---------------------------------------------------------------------------------------------
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
await qa.note(`answered ${floorAnswered} floor questions before the eligibility block opened`);
await qa.scrollThrough('read the CV the floor answers wrote, then back to the dock');

// ---------------------------------------------------------------------------------------------
// 4. The work-rights question. #162: years-experience is NO LONGER ASKED — it is worked out from
//    the dated job records (ADR-0008 clause 2), so the block opens on work-rights now.
// ---------------------------------------------------------------------------------------------
await assert((await eligDim()) === 'work-rights', `the eligibility block opens on work-rights (got "${await eligDim()}")`);
await assert(!/how many years/i.test((await askQ()) ?? ''), '#162: nothing asks for a years-of-experience total');
await qa.expectVisible('.discovery #ask-q', 'the work-rights question, as a real visitor reads it');
await qa.note(`work-rights question: ${JSON.stringify(await askQ())}\n  options: ${JSON.stringify(await optLabels())}`);
await qa.click(page.locator('.discovery .opts .opt').first(), 'answer work-rights with the first option');
await page.waitForTimeout(2300);
await qa.expectVisible('.discovery .notice', 'the answer is confirmed as reusable — never asked again');

// ---------------------------------------------------------------------------------------------
// 6. THE LANGUAGES QUESTION — now a multi-select. It must still be asked, accept a confirmed set,
//    and close.
// ---------------------------------------------------------------------------------------------
const langDim = await eligDim();
await assert(langDim === 'language', `#107 regression: the languages question is STILL ASKED (got "${langDim}")`);
const langQ = await askQ();
// #165: a TYPE-AHEAD, not a tick-list. The options are completions now, so they are read from the
// suggestion list as the person types rather than from a rendered set of checkboxes.
await qa.expectVisible('.discovery .lang-typeahead #lang-input', '#165: the languages question renders as a type-ahead');
await qa.note(`language question: ${JSON.stringify(langQ)}`);
await assert(/Which languages do you speak\?/.test(langQ ?? ''), `the languages question reads as designed — "${langQ}"`);
await qa.fill('#lang-input', 'Eng', 'type three letters of a language on the list');
await page.waitForTimeout(700);
const langOpts = await page.locator('.discovery .sugg button').allTextContents();
await qa.note(`completions offered: ${JSON.stringify(langOpts)}`);
await assert(langOpts.some((o) => o.trim() === 'English'),
  `the type-ahead completes English from the known list (offered: ${JSON.stringify(langOpts)})`);

await qa.click(page.locator('.discovery .sugg button', { hasText: 'English' }).first(), 'add English from the completions');
await page.waitForTimeout(600);
await qa.click(page.locator('.discovery .elig-actions .go'), 'confirm the languages answer');
await page.waitForTimeout(3000);
await qa.note(`after the languages answer the visitor is at: ${page.url()} — discovery's last question, so the app moves straight on`);

// ---------------------------------------------------------------------------------------------
// 7. THE RE-ASK REGRESSION — the #107 language scope change's live risk. Reload discovery as a
//    returning visitor: no eligibility question may come back, and the API must agree.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', '#107 regression: reload discovery as a returning visitor');
await page.waitForTimeout(2600);
await qa.scrollThrough('read the whole screen a returning visitor lands on');
const qAfterReload = await askQ();
const dimAfterReload = await eligDim();
await qa.note(`after reload — question on screen: ${JSON.stringify(qAfterReload)}; eligibility dimension: ${JSON.stringify(dimAfterReload)}`);
await assert(
  !/Which languages do you speak\?/.test(qAfterReload ?? ''),
  `#107 KEY REGRESSION: the languages question does NOT re-ask itself on screen (on screen: "${qAfterReload}")`,
);

// The screen alone could be silent for other reasons; ask the API what it still intends to ask.
const state = await page.evaluate(async () => {
  const r = await fetch('/api/onboarding/discovery', { credentials: 'include' });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const qs = (j.questions ?? []);
  return {
    ok: true,
    open: qs.filter((q) => !q.answer && !q.closed).map((q) => q.question ?? q.itemId),
    eligibilityOpen: qs.filter((q) => q.eligibility && !q.answer && !q.closed).map((q) => q.eligibility.dimension),
    all: qs.map((q) => q.itemId),
  };
});
await qa.note(`GET /onboarding/discovery on reload -> ${JSON.stringify(state)}`);
await qa.expectVisible('body', '#107 KEY REGRESSION: the API re-issues NO eligibility question after all three were answered');
await assert(
  state.ok === true && (state.eligibilityOpen ?? []).length === 0,
  `#107 KEY REGRESSION: no eligibility question is re-asked by the API (still open: ${JSON.stringify(state.eligibilityOpen)})`,
);
await qa.note(
  'Note on evidence: GET /onboarding/discovery only returns questions still in play, so an ANSWERED ' +
  'eligibility item is absent from it by design. The proof that the #107 scope change did not break ' +
  'the "never re-ask" rule is exactly that emptiness above, plus the screen showing no language question.',
);

// ---------------------------------------------------------------------------------------------
// 7b. The signup wall — a real visitor signs in before the deck opens (S2).
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'to the deck — the signup wall stands in front of it');
await page.waitForTimeout(2500);
const signedIn = await page.evaluate(async () => {
  const email = `qa107-${Date.now()}@example.com`;
  const r = await fetch('/api/auth/request-link', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.devLink) return { ok: false, status: r.status, body: j };
  const token = new URL('http://x' + j.devLink).searchParams.get('token');
  const v = await fetch('/api/auth/verify', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
  });
  return { ok: v.ok, status: v.status, email };
});
await qa.note(`sign-in: ${JSON.stringify(signedIn)}`);
await assert(signedIn.ok === true, `the visitor signs in past the wall (${JSON.stringify(signedIn)})`);

// ---------------------------------------------------------------------------------------------
// 8. The deck — it must still assemble, with cards, after everything above.
//    A COLD deck fans one real model call out per card behind the web app's own /api/* proxy
//    deadline, so the first load can legitimately time out. A visitor presses "Try again"; so do we.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'open the deck');
let deck = null;
for (let attempt = 1; attempt <= 4 && !deck; attempt++) {
  const got = await page.evaluate(async () => {
    const t = Date.now();
    try {
      const r = await fetch('/api/onboarding/cards', { credentials: 'include' });
      if (!r.ok) return { ok: false, status: r.status, ms: Date.now() - t };
      const j = await r.json();
      return {
        ok: true, ms: Date.now() - t, count: j.cards.length,
        ids: j.cards.map((c) => c.adId), pcts: j.cards.map((c) => c.matchPct),
        scored: j.cards.map((c) => c.scored),
      };
    } catch (e) { return { ok: false, error: String(e), ms: Date.now() - t }; }
  });
  await qa.note(`deck load attempt ${attempt}: ${JSON.stringify(got).slice(0, 400)}`);
  if (got.ok) deck = got;
  else await page.waitForTimeout(5000);
}
await assert(deck !== null, 'the deck returns a 200 within four attempts');
if (deck) {
  await assert(deck.count > 0, `the deck is NOT empty — ${deck.count} card(s) reached this visitor after the eligibility answers`);
  // matchPct is null BY DESIGN for "pending"/"unscored" cards (#117) — only a scored card claims a
  // number, so only those are checked for one.
  const numbered = deck.pcts.filter((_, i) => deck.scored[i] === 'judged' || deck.scored[i] === 'estimated');
  await qa.note(`card provenance: ${JSON.stringify(deck.scored)}; numbers on scored cards: ${JSON.stringify(numbered)}`);
  await assert(
    numbered.length > 0 && numbered.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100),
    `every SCORED card carries a real number — none null/NaN/negative (${JSON.stringify(numbered)})`,
  );
}

// Now drive the UI itself, pressing "Try again" the way a visitor would if it errored.
for (let i = 0; i < 3; i++) {
  if (await page.getByRole('button', { name: 'Try again' }).isVisible().catch(() => false)) {
    await qa.click(page.getByRole('button', { name: 'Try again' }), 'the deck screen errored on the cold load — press "Try again", as a visitor would');
    await page.waitForTimeout(6000);
  } else break;
}
if (await page.getByRole('button', { name: 'See them' }).isVisible().catch(() => false)) {
  await qa.expectVisible(page.getByRole('heading', { name: /matched you/ }), 'the reveal headline counts the matches');
  await qa.click(page.getByRole('button', { name: 'See them' }), 'press "See them" — the deck opens on the best match');
  await page.waitForTimeout(2000);
}
await qa.scrollThrough('read the top card the way a person does');
await qa.expectVisible(page.locator('.jobcard h2').first(), 'the card leads with the job title');
await qa.expectVisible(page.locator('.jobcard .score').first(), 'the card carries a number');

// ---------------------------------------------------------------------------------------------
// 9. The tailor screen — the flow through to tailoring is not broken.
// ---------------------------------------------------------------------------------------------
await qa.click(
  page.getByRole('button', { name: 'I want this one, tailor this job' }),
  'choose this job — "I want this one"',
);
for (let i = 0; i < 8 && !page.url().includes('/tailor'); i++) await page.waitForTimeout(2000);
await qa.scrollThrough('read the tailor screen top to bottom');
await qa.note(`after choosing a job the visitor is at: ${page.url()}`);
await qa.expectVisible('.jobdeck.tailor', 'the visitor reaches the tailor screen');
const bodyText = (await page.locator('body').innerText()).toLowerCase();
await assert(
  !/you can(?:not|'t|’t) apply|not eligible|you don't qualify|you do not qualify/.test(bodyText),
  'UX intent: nothing anywhere tells the visitor they cannot have a job',
);

await qa.note(
  'COVERAGE GAP (honest): no shipped posting fixture carries a blocking language requirement, so a ' +
  'real withdrawal cannot be produced through this UI without inventing product data. The withdrawal ' +
  'itself is covered at the API boundary in apps/api/test/cards.test.ts (#107 describes).',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
