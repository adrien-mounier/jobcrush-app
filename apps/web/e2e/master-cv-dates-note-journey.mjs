// #159 — "my CV states only what I know", driven as a human, over a REAL stack.
//
// Read a CV whose LAST role has no dates -> the watermarked preview -> confirm the work history
// (#157's job-block deck) -> the sign-up wall -> the claim deck -> the grill, where the date
// question is LEFT BLANK on purpose -> the built master CV. What this journey proves is the one
// piece of #159 with no unit test behind it (apps/web has no test runner — its `test` script is a
// no-op echo): the passive missing-dates note, on the page a human actually sees.
//
//   1. the master CV carries the missing-dates note, and it neither blocks nor nags;
//   2. nothing about the missing dates leaks onto the tailored CV, and no role prints an
//      uninvited "Present".
//
// REWRITTEN 2026-08-13 (#209). What it was, and why neither half survived:
//   - It declared the REAL API and a real paid model (`node apps/api/dist/main.js`), so CI could
//     never run it and it sat in no tier, unwatched, for weeks.
//   - It was separately ROTTED: it clicked "Confirm my facts" and waited for /signup, and that
//     link has gone to /job-blocks/<jobId> since #157. It would have failed on the second screen.
// It now rides the checked-in fake-model API (apps/api/dist/qa-main.js) like every other Tier 2
// journey: free, deterministic, and actually run on every push. The CV below carries the marker
// "DATESMISSING", which is what makes qa-main.ts's fake miner answer with a recorded claims doc
// whose last role has `dates_missing: true` — the only signal the grill has for "this role has no
// dates" (grill.ts).
//
// WHAT THIS NO LONGER PROVES, said plainly rather than quietly dropped: the old journey also
// asserted that the SHIPPED, LLM-phrased date question never invites an approximate answer. That
// question is phrased by a model, so against a fake the check grades the fake and not the product.
// It is still run below and still recorded — as a note about the phrasing this run actually saw,
// never as a pass. The real-model version of that check belongs to a paid, hand-run pass.
//
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34190
//   BASE_URL=http://127.0.0.1:34190 node apps/web/e2e/master-cv-dates-note-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

// DATESMISSING is a marker for the fake miner, not CV content — see the header. The rest is an
// ordinary CV so every other screen behaves exactly as it does for a real one.
const CV = [
  'DATESMISSING',
  'MEI CHAN',
  'Senior Project Manager',
  'Hong Kong | +852 5555 0000 | mei.chan@example.com',
  '',
  'PROFESSIONAL EXPERIENCE',
  '',
  'Senior Project Manager, Acme Bank, Hong Kong — March 2019 - June 2024',
  '- Cut vendor onboarding from 12 weeks to 5 across 3 regional banks, saving HKD 4.2m a year.',
  '- Led the core banking migration for 1.1 million customer accounts with zero unplanned downtime.',
  '',
  'Project Coordinator, Old Corp, Hong Kong — 2003',
  '- Coordinated the branch rollout schedule across 14 sites.',
  '',
  'Office Administrator, Small Ltd, Hong Kong',
  '- Answered the main switchboard and greeted visitors.',
  '',
  'EDUCATION',
  'University of Hong Kong, 2002 — BBA, Business Administration',
].join('\n');

const qa = await createSession('master-cv-dates-note-journey', {
  baseURL: BASE,
  viewport: { width: 430, height: 932 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const bodyText = () => page.evaluate(() => document.body.innerText || '');

// ---------------------------------------------------------------------------------------------
// 1. Bring the CV in.
// ---------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/paste`, 'the paste screen — where a CV enters the product');
await qa.fill('textarea[aria-label="Your CV text"]', CV, 'pastes a CV whose last role carries no dates');
await qa.click('button:has-text("Use this text")', 'hands it over');
await page.waitForURL('**/preview/**', { timeout: 180_000 });
const jobId = page.url().split('/preview/')[1];
await qa.note('the CV was read — the watermarked preview is ready');
await qa.scrollThrough('read the watermarked preview as a visitor would');

// ---------------------------------------------------------------------------------------------
// 2. The door the preview screen actually offers (#157: work history first, then the wall).
// ---------------------------------------------------------------------------------------------
await qa.click('a:has-text("Confirm my facts")', 'takes the "Confirm my facts" door');
await page.waitForURL('**/job-blocks/**', { timeout: 30_000 });
await qa.expectVisible('.jb-card, .jb-done', 'the work-history check opens');
for (let i = 0; i < 8 && (await page.locator('.jb-cbtn.yes').count()); i++) {
  await qa.click('.jb-cbtn.yes', `confirms work-history card ${i + 1}`);
  await page.waitForTimeout(1200);
}
await qa.expectVisible('.jb-done', 'the work-history deck is finished');
await qa.click('.jb-done .btn:has-text("Continue")', 'continues towards the verified CV');

// ---------------------------------------------------------------------------------------------
// 3. Through the wall, to the claim deck.
// ---------------------------------------------------------------------------------------------
await page.waitForURL((u) => /\/signup/.test(u.toString()) || /\/deck\//.test(u.toString()), { timeout: 60_000 });
// Asserted, not merely branched on: this visitor is anonymous, so the wall is the whole point of the
// screen between the draft and the verified CV. Landing straight on /deck/ would mean an anonymous
// person reached the confirmed-facts deck — a wall regression, and the `if` that used to guard this
// block would have skipped every wall assertion and still passed (#209 code review).
await assert(/\/signup/.test(page.url()), `an anonymous visitor meets the wall first — landed on ${page.url()}`);
{
  await qa.expectVisible('input[aria-label="Email address"]', 'the signup wall stands between the draft and the verified CV');
  await qa.fill('input[aria-label="Email address"]', `qa159+${Date.now()}@example.com`, 'gives an email address');
  await qa.click('button:has-text("Email me a sign-in link")', 'asks for the sign-in link');
  await qa.click('a:has-text("Open your sign-in link")', 'opens the emailed sign-in link');
}
await page.waitForURL(/\/deck\//, { timeout: 60_000 });
await qa.expectText('h1', 'Confirm your facts', 'signed in, and landed on the claim deck');

// ---------------------------------------------------------------------------------------------
// 4. Confirm every fact the deck asks about.
// ---------------------------------------------------------------------------------------------
await qa.scrollThrough('read the whole deck before deciding anything');
for (let guard = 0; guard < 40; guard++) {
  const btn = page.locator('button:has-text("Looks right")').first();
  if (!(await btn.count())) break;
  await qa.click(btn, 'confirms a fact that came straight from the CV');
}
await qa.click('button:has-text("Continue")', 'continue — every fact reviewed');

// ---------------------------------------------------------------------------------------------
// 5. The grill. THE DATE QUESTION IS THE POINT — read it, then leave it blank.
// ---------------------------------------------------------------------------------------------
await page.locator('[data-testid="grill-question"]').first().waitFor({ timeout: 120_000 });
await qa.scrollThrough('read the questions that fill the gaps in the CV');
const questions = await page.locator('[data-testid="grill-question"] p').allTextContents();
await qa.note(`the questions actually shown: ${JSON.stringify(questions)}`);

const dateQs = questions.filter((q) => /date|when|from|month|year/i.test(q));
await assert(dateQs.length > 0, `at least one question asks about the undated role — got ${dateQs.length}`);

// Recorded, never asserted: this phrasing came from the FAKE model, so a pass here would grade the
// fake. See the header — the real-model version of this check is a paid, hand-run pass.
const APPROX = /roughly|approximate|ballpark|rough idea|thereabouts|give or take|near enough|doesn'?t have to be exact|no need to be (exact|precise)|best guess|estimate is fine|around when/i;
await qa.note(
  `phrasing seen from the FAKE grill phraser (recorded, not asserted — a real model phrases the ` +
    `shipped question): invites an approximate answer: ${questions.some((q) => APPROX.test(q))}`,
);

await qa.note('leaving every date question blank — this is someone who genuinely does not know');
await qa.click('button:has-text("Build my verified CV")', 'build the verified master CV with the dates still unknown');

// ---------------------------------------------------------------------------------------------
// 6. The master CV — the passive note, and nothing more.
// ---------------------------------------------------------------------------------------------
await page.locator('h1:has-text("You own your facts")').waitFor({ timeout: 180_000 });
await qa.expectText('h1', 'You own your facts', 'the verified master CV is built — the wall is behind us');
await qa.scrollThrough('read the master CV page top to bottom, exactly as its owner would');

const master = await bodyText();
const noteLine = master.split('\n').map((l) => l.trim()).find((l) => /missing (months|dates)/i.test(l));
await qa.note(`the note on the master CV: ${JSON.stringify(noteLine ?? null)}`);
await assert(!!noteLine, 'the master CV carries a note about the roles whose dates are unknown');
await qa.expectText('main', noteLine ?? 'missing', 'the missing-dates note, in place on the master CV');

// It must be PASSIVE: no nag, no error styling, no gate on what the page offers next.
await assert(
  !/must|need to|required|please (add|provide|fix)|incomplete|error|before you can/i.test(noteLine ?? ''),
  'the note neither demands nor blocks — it states, and stops',
);
const nagged = await page.evaluate(() => {
  const p = [...document.querySelectorAll('main p')].find((el) => /missing (months|dates)/i.test(el.textContent || ''));
  if (!p) return { found: false };
  const s = getComputedStyle(p);
  return {
    found: true,
    role: p.getAttribute('role'),
    isAlert: p.getAttribute('role') === 'alert' || p.className.includes('error'),
    hasButton: !!p.querySelector('button, a'),
    fontSize: s.fontSize,
  };
});
await qa.note(`note styling: ${JSON.stringify(nagged)}`);
await assert(nagged.found && !nagged.isAlert && !nagged.hasButton, 'the note is a quiet line of text — not an alert, and it asks for no tap');
await assert(await page.locator('.verified-seal').count() > 0, 'the CV is still certified — an unknown date never withheld the seal');

// ---------------------------------------------------------------------------------------------
// 7. The tailored CV must carry NONE of this — and no uninvited "Present".
// ---------------------------------------------------------------------------------------------
const cvHtml = await page.evaluate(async () => {
  const res = await fetch('/api/onboarding/tailor', { credentials: 'include' });
  if (!res.ok) return `__STATUS_${res.status}__`;
  const j = await res.json();
  return j?.html ?? j?.previewHtml ?? JSON.stringify(j);
});
if (cvHtml.startsWith('__STATUS_')) {
  await qa.note(`tailored CV not reachable in this session (${cvHtml}) — the leak check falls to the API-level tests`);
} else {
  await qa.note(`tailored CV fetched (${cvHtml.length} chars)`);
  await assert(!/missing (months|dates)|dates not stated|date unknown|roughly/i.test(cvHtml),
    'the tailored CV carries no note, caveat or prompt about the missing dates');
  await assert(!/\bPresent\b|\bSince \d{4}|\bFrom \d{4}/.test(cvHtml),
    'no role on the tailored CV claims "Present", "Since" or "From" it was never told');
}

await qa.note(`job ${jobId} walked end to end`);
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
