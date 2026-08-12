// #123 — "which languages do you work in?", the answer that arms #107's withdrawal engine.
//
// Front door -> discovery -> the floor -> years -> work-rights -> THE LANGUAGES MULTI-SELECT
// (keyboard-driven, nothing pre-ticked, English ticked / Mandarin deliberately left unticked)
// -> sign in -> the deck, where a Mandarin-MANDATORY posting must be ABSENT and a
// "Mandarin an advantage" posting must be PRESENT -> a correction that ticks Mandarin and
// brings the withdrawn job BACK.
//
//   node <scratch>/qa-main.mjs                     # PORT=30191 — see the ADVERT NOTE below
//   cd apps/web && API_URL=http://127.0.0.1:30191 npx next build && npx next start -p 30190
//   BASE_URL=http://127.0.0.1:30190 node apps/web/e2e/language-withdrawal-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.
//
// ADVERT NOTE, stated up front rather than implied: apps/api/data/sample-ad-requirements.json
// contains NO `kind: "blocking"` requirement and no language requirement of any kind, so the
// SHIPPED corpus cannot produce a withdrawal through this UI. This flow expects the API to be
// serving two adverts with language requirements (Mandarin mandatory / Mandarin an advantage),
// supplied at the app's own pinned reader seam (BuildOptions.readAd) exactly as
// apps/api/test/cards.test.ts does. The VISITOR'S ANSWER is never seeded — it is ticked in the
// browser through the real routes, which is the half of the loop #123 exists to close. When those
// adverts are absent (a plain `node apps/api/dist/main.js`), the deck assertions self-skip with a
// recorded note rather than failing.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30190';
const ROLE = 'IT project manager in Hong Kong';
const BLOCKING_AD = process.env.QA_BLOCKING_AD ?? '2026-07-05_okx_senior-strategy-project-manager-vip-institutions';
const ADVANTAGE_AD = process.env.QA_ADVANTAGE_AD ?? '2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting';

// The reveal's removal line (L7) — the number on it must equal the jobs actually missing, or the
// line lies to the visitor. Mirrors the client's own join/pluralisation so the assertion is on the
// sentence a person READS, not on the JSON behind it.
const joinLanguages = (i) => i.length <= 1 ? (i[0] ?? '')
  : i.length === 2 ? `${i[0]} and ${i[1]}`
    : `${i.slice(0, -1).join(', ')} and ${i[i.length - 1]}`;
const expectedLine = (w) => (!w || w.total <= 0 || w.byLanguage.length === 0) ? null
  : `${w.total} more needed ${joinLanguages(w.byLanguage.map((l) => l.language))} — I left ${w.total === 1 ? 'it' : 'them'} out.`;

const qa = await createSession('language-withdrawal-journey', {
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
const deckIds = () => page.evaluate(async () => {
  const r = await fetch('/api/onboarding/cards', { credentials: 'include' });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return { ok: true, ids: j.cards.map((c) => c.adId), count: j.cards.length, withdrawn: j.withdrawn ?? null };
});

// ---------------------------------------------------------------------------------------------
// 1. The front door, read the way a visitor reads it.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom');

// ---------------------------------------------------------------------------------------------
// 2. Q1 — the role.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1: type the role');
await qa.click(page.getByRole('button', { name: "That's me" }), 'Q1: submit the role');
await page.waitForTimeout(1800);
await qa.expectVisible('.discovery .countdown', 'the countdown appears with the first question');

// ---------------------------------------------------------------------------------------------
// 3. Walk the discovery floor until the eligibility block opens (REGRESSION: the surrounding flow
//    still works — #123 replaced a live question inside it).
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
await qa.note(`REGRESSION: answered ${floorAnswered} floor questions before the eligibility block opened — the pre-existing flow is intact`);
await qa.scrollThrough('read the CV the floor answers wrote, then back to the dock');

// ---------------------------------------------------------------------------------------------
// 4. work-rights — the eligibility question #123 did NOT touch. #162 removed years-experience
//    from the ask-list entirely (worked out from the dated job records, ADR-0008 clause 2).
// ---------------------------------------------------------------------------------------------
await assert((await eligDim()) === 'work-rights', `REGRESSION: work-rights is still asked (got "${await eligDim()}")`);
await assert(!/how many years/i.test((await askQ()) ?? ''), '#162: nothing asks for a years-of-experience total');
await qa.click(page.locator('.discovery .opts .opt').first(), 'answer work-rights with the first option');
await page.waitForTimeout(2300);

// ---------------------------------------------------------------------------------------------
// 5. THE LANGUAGES QUESTION — the thing this ticket shipped.
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(600);
await qa.scrollThrough('read the languages question the way a hurried visitor would');
const langQ = await askQ();
const conseq = await txt('.discovery .conseq');
await qa.note(`AC5 question stem : ${JSON.stringify(langQ)}`);
await qa.note(`AC5 consequence   : ${JSON.stringify(conseq)}`);
await qa.expectVisible('.discovery fieldset.elig-group', '#123: the languages question renders as a CHECKBOX GROUP (fieldset + legend), not a single-pick list');

const boxes = page.locator('.discovery .opt.check input[type=checkbox]');
const labels = await page.locator('.discovery .opt.check .lbl').allTextContents();
await qa.note(`the tick-list offers: ${JSON.stringify(labels)}`);
await assert(labels.length === 4 && labels.includes('English') && labels.includes('Mandarin'),
  `AC1: a MULTI-select over ${labels.length} languages — more than one is representable in one answer`);

// Nothing pre-ticked.
const preChecked = await boxes.evaluateAll((els) => els.filter((e) => e.checked).length);
await assert(preChecked === 0, `nothing is pre-ticked on the first ask (${preChecked} boxes checked)`);

// AC5, judged as a person: the consequence must be in the QUESTION, not discovered later.
await assert(/unticked/i.test(langQ ?? ''),
  `AC5: the consequence of leaving a language unticked is stated in the QUESTION STEM itself — "${langQ}"`);
await assert(/out of your deck|take[s]? jobs/i.test(conseq ?? ''),
  `AC5: the consequence line spells out that a no REMOVES JOBS — "${conseq}"`);

// a11y: the group is programmatically described by the consequence, and each box is a real checkbox.
const a11y = await page.evaluate(() => {
  const fs = document.querySelector('.discovery fieldset.elig-group');
  const legend = fs?.querySelector('legend');
  const describedby = fs?.getAttribute('aria-describedby');
  const desc = describedby ? document.getElementById(describedby)?.textContent?.trim() : null;
  const inputs = [...document.querySelectorAll('.discovery .opt.check input[type=checkbox]')];
  return {
    hasFieldset: !!fs,
    legend: legend?.textContent?.trim() ?? null,
    describedby,
    describedbyResolves: !!desc,
    everyBoxLabelled: inputs.every((i) => !!i.closest('label')?.querySelector('.lbl')?.textContent?.trim()),
    boxCount: inputs.length,
  };
});
await qa.note(`screen-reader shape: ${JSON.stringify(a11y)}`);
await assert(a11y.hasFieldset && !!a11y.legend, 'a11y: the group is a <fieldset> whose <legend> IS the question — a screen reader announces it with every box');
await assert(a11y.describedbyResolves, `a11y: aria-describedby="${a11y.describedby}" resolves to the consequence line, so the removal warning is announced too`);
await assert(a11y.everyBoxLabelled, 'a11y: every checkbox sits inside a <label> carrying its language name');

// KEYBOARD ONLY: tab to the first box and tick English with Space. No mouse.
await qa.click(page.locator('.discovery legend.q'), 'move focus into the question area before driving by keyboard');
await boxes.first().focus();
await qa.press(boxes.first(), ' ', 'KEYBOARD ONLY: focus the first checkbox and press Space to tick "English"');
await page.waitForTimeout(900);
const keyboardState = await boxes.evaluateAll((els) => els.map((e) => e.checked));
await qa.note(`after one Space press: ${JSON.stringify(keyboardState)}`);
await assert(keyboardState[0] === true, 'KEYBOARD: Space ticks a language — the tick-list is operable with no mouse');

// Tab through the rest to prove they are all reachable, ticking nothing.
const reached = await page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const a = document.activeElement;
    if (a?.type === 'checkbox') seen.push(a.closest('label')?.querySelector('.lbl')?.textContent?.trim());
    const inputs = [...document.querySelectorAll('.discovery .opt.check input[type=checkbox]')];
    const idx = inputs.indexOf(a);
    if (idx >= 0 && idx + 1 < inputs.length) inputs[idx + 1].focus(); else break;
  }
  return seen;
});
await qa.note(`KEYBOARD: tab order reaches ${JSON.stringify(reached)} — every language is focusable`);

// The YES/NO markers a hurried visitor sees, and the confirm button's own wording.
const markers = await page.locator('.discovery .opt.check .state').allTextContents();
const confirmLabel = await txt('.discovery .elig-actions .go');
const declineLabel = await txt('.discovery .elig-actions .opt.quiet .lbl');
await qa.note(`per-language markers with English ticked: ${JSON.stringify(markers)}`);
await qa.note(`confirm button: ${JSON.stringify(confirmLabel)} | decline button: ${JSON.stringify(declineLabel)}`);
await assert(markers.includes('NO'),
  'DECLINE-vs-NOTHING clarity: with one language ticked, every UNTICKED language is visibly marked "NO" before the visitor confirms');
await assert(/ask me later/i.test(declineLabel ?? ''),
  `the decline ("${declineLabel}") is a SEPARATE control from the confirm ("${confirmLabel}") — they cannot be pressed by accident for each other`);

// DECLINE vs TICKING NOTHING — the two answers that mean opposite things. Untick everything and
// look at exactly what a hurried person sees before they commit.
await qa.click(boxes.first(), 'untick English again to inspect the ZERO-TICKED state a hurried visitor could confirm');
await page.waitForTimeout(900);
const zeroMarkers = await page.locator('.discovery .opt.check .state').allTextContents();
const zeroConfirm = await txt('.discovery .elig-actions .go');
await qa.note(`ZERO TICKED — per-language markers: ${JSON.stringify(zeroMarkers)}; confirm button reads: ${JSON.stringify(zeroConfirm)}`);
await qa.expectVisible('.discovery .elig-actions .go', 'ZERO TICKED: the confirm button renames itself so it cannot be confused with the decline');
await assert(/can't work in any of these|cannot work in any of these/i.test(zeroConfirm ?? ''),
  `DECLINE-vs-NOTHING: with nothing ticked the confirm button says "${zeroConfirm}" — it never reads like "Ask me later"`);
await assert(!zeroMarkers.some((m) => m.trim() === 'NO'),
  `OBSERVATION (not a defect on its own): with nothing ticked, NO per-language "NO" markers are shown (${JSON.stringify(zeroMarkers)}) — the button label is the only signal that this answer records a no against all four`);

await qa.click(boxes.first(), 'tick English back on — the real answer this visitor is giving');
await page.waitForTimeout(900);

// BASELINE: the deck this visitor would have had if they had never answered. The removal line's
// number is checked against THIS, not against itself.
const before = await deckIds();
await qa.note(`BASELINE deck before the language answer: ${before.count} cards, withdrawn=${JSON.stringify(before.withdrawn)}`);
await assert(before.ok && before.withdrawn && before.withdrawn.total === 0,
  `before answering, nothing is withdrawn (${JSON.stringify(before.withdrawn)}) — the safety rule holds up to the last moment`);
const baselineHasLanguageAdverts = before.ok
  && before.ids.includes(BLOCKING_AD)
  && before.ids.includes(ADVANTAGE_AD);
await qa.note(
  `language-advert prerequisites in the BASELINE deck: blocking=${before.ok && before.ids.includes(BLOCKING_AD)}, ` +
  `advantage=${before.ok && before.ids.includes(ADVANTAGE_AD)}`,
);

await qa.expectVisible('.discovery .elig-actions', 'AC2 setup: English ticked, MANDARIN DELIBERATELY LEFT UNTICKED — the answer that must remove Mandarin-mandatory jobs');
await qa.click(page.locator('.discovery .elig-actions .go'), `confirm the answer: "${confirmLabel}"`);
await page.waitForTimeout(3000);
await qa.scrollThrough('read the screen after the languages answer lands');

// ---------------------------------------------------------------------------------------------
// 6. Sign in past the wall, then the deck.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'to the deck — the signup wall stands in front of it');
await page.waitForTimeout(2200);
const signedIn = await page.evaluate(async () => {
  const email = `qa123-${Date.now()}@example.com`;
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
await assert(signedIn.ok === true, `the visitor signs in past the wall (${JSON.stringify(signedIn)})`);

await qa.goto('/deck', 'open the deck — the moment of truth for AC2 and AC3');
await page.waitForTimeout(3000);
let after = null;
for (let attempt = 1; attempt <= 4 && !after; attempt++) {
  const got = await deckIds();
  await qa.note(`deck load attempt ${attempt}: ${JSON.stringify(got).slice(0, 500)}`);
  if (got.ok) after = got; else await page.waitForTimeout(4000);
}
await assert(after !== null, 'the deck returns a 200');

await qa.scrollThrough('scroll the whole deck the way a visitor browses it');
await qa.expectVisible('body', 'the deck a visitor who does NOT work in Mandarin actually receives');

if (!baselineHasLanguageAdverts) {
  await qa.note(
    'SKIPPED AC2/AC3/AC6 deck assertions — the BASELINE deck did not contain BOTH required language ' +
    'advert fixtures (the shipped sample-ad-requirements.json has none). Re-run against an API wired ' +
    'with the two language adverts described in this file\'s header to exercise them.',
  );
} else if (!after) {
  await qa.note(
    'AC2/AC3/AC6 assertions could not run because the post-answer deck failed to return; the baseline ' +
    'prerequisites were present and the earlier deck assertion already makes this report fail.',
  );
} else {
  // -------------------------------------------------------------------------------------------
  // THE REMOVAL IS VISIBLE (L7). These checks depend on the language adverts above; when those
  // preconditions are absent, none of them runs (including the `.aside` evidence assertion).
  // -------------------------------------------------------------------------------------------
  const onScreenLine = await txt('.reveal .aside, .deck .aside, .aside');
  const reveal = await txt('.big, .reveal h1, h1');
  await qa.note(`the reveal heading: ${JSON.stringify(reveal)}`);
  await qa.note(`the removal line on screen: ${JSON.stringify(onScreenLine)}`);
  await qa.expectVisible('.aside', 'THE FIX: the visitor is TOLD what was left out, right under the reveal — removal is no longer silent');

  const missing = before.ids.filter((id) => !after.ids.includes(id));
  await qa.note(`jobs actually missing versus the baseline deck (${missing.length}): ${JSON.stringify(missing)}`);
  await qa.note(`server reported: ${JSON.stringify(after.withdrawn)}`);
  await assert(after.withdrawn && after.withdrawn.total === missing.length,
    `THE NUMBER ON SCREEN MATCHES REALITY: the line says ${after.withdrawn?.total} and exactly ${missing.length} jobs are actually gone (deck ${before.count} -> ${after.count})`);
  await assert(onScreenLine === expectedLine(after.withdrawn),
    `the sentence a visitor reads is exactly the designed line: "${onScreenLine}"`);
  await assert((after.withdrawn?.byLanguage ?? []).reduce((a, l) => a + l.count, 0) === after.withdrawn?.total,
    'the per-language counts sum to the total — no unnamed exclusion is folded into the sentence');

  await assert(!after.ids.includes(BLOCKING_AD),
    `AC2: the posting that DEMANDS fluent Mandarin is GONE from the deck of a visitor who did not tick Mandarin (${after.count} cards remain)`);
  await assert(after.ids.includes(ADVANTAGE_AD),
    'AC3: the posting where Mandarin is only "an advantage" is STILL IN the deck — a preference never removes a job');

  // -------------------------------------------------------------------------------------------
  // 7. AC6 — the correction. Back into discovery, re-answer WITH Mandarin, watch the job return.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/discovery', 'back into discovery to correct the answer');
  await page.waitForTimeout(2600);
  await qa.scrollThrough('look for the way back to the languages answer, as a returning visitor would');

  const fixButton = page.locator('.discovery .notice button').first();
  const canFixInFlow = await fixButton.count() > 0;
  await qa.note(`in-flow correction affordance visible after a reload: ${canFixInFlow}`);

  if (canFixInFlow) {
    await qa.click(fixButton, 'AC6: press the correction affordance to re-open the languages question');
    await page.waitForTimeout(1600);
    const reTicked = await page.locator('.discovery .opt.check input[type=checkbox]').evaluateAll((els) => els.map((e) => e.checked));
    await qa.note(`re-opened with prior answer pre-ticked: ${JSON.stringify(reTicked)}`);
    await qa.click(page.locator('.discovery .opt.check').filter({ hasText: 'Mandarin' }), 'AC6: tick Mandarin this time');
    await page.waitForTimeout(900);
    await qa.click(page.locator('.discovery .elig-actions .go'), 'AC6: confirm the corrected answer');
    await page.waitForTimeout(2600);
  } else {
    await qa.note(
      'GAP (open ticket #120, out of scope for #123): after a page reload there is NO durable way back ' +
      'to the languages question in the UI. The correction is therefore driven over the wire below — ' +
      'the same route the button calls — so AC6 is proven at the API, not through a button a returning ' +
      'visitor can actually reach.',
    );
    const corrected = await page.evaluate(async () => {
      const s = await (await fetch('/api/onboarding/discovery', { credentials: 'include' })).json();
      const r = await fetch('/api/onboarding/discovery/answer', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'eligibility-languages', answers: ['English', 'Mandarin'] }),
      });
      return { status: r.status, openQuestions: (s.questions ?? []).length };
    });
    await qa.note(`correction over the wire: ${JSON.stringify(corrected)}`);
  }

  await qa.goto('/deck', 'AC6: back to the deck after correcting the answer');
  await page.waitForTimeout(3000);
  let back = null;
  for (let attempt = 1; attempt <= 4 && !back; attempt++) {
    const got = await deckIds();
    if (got.ok) back = got; else await page.waitForTimeout(4000);
  }
  await qa.note(`deck after the correction: ${JSON.stringify(back).slice(0, 500)}`);
  await qa.scrollThrough('scroll the corrected deck');
  await assert(back && back.ids.includes(BLOCKING_AD),
    'AC6: after ticking Mandarin, the Mandarin-mandatory posting is BACK in the deck — withdrawal follows the correction');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
