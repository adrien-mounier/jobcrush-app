// #418 (spec #412, ADR-0020 clause 4) — the new flow end to end, human-paced, over a REAL stack:
// pick a job → the draft is the first thing on the screen → a stretch suggestion opens beside it,
// previewed in place → #420: its wording edited in place on the draft, what to say rewritten for
// it → "Use for this job" → the score moves (no "+N%") and the requirement reads *met by a stretch*
// on the sheet → "Ready to send" lists the answer with Undo → approve → Done.
//
// Nothing here is stubbed: discovery -> reveal -> sign-in -> deck -> swipe right -> /tailor -> draft
// -> suggestion -> Use -> approve all run against the live Fastify API on the fake-model QA stack
// (qa-main: the fake judge meets the first requirement and leaves the rest open; the fake stretch
// step suggests one bullet swap for the first unmet requirement and one skill for the second; the
// fake report answers from the prompt's own states). No ANTHROPIC_API_KEY is needed.
//
// A computer viewport on purpose (1280px): the card sits in the rail and the swap previews IN PLACE
// on the draft, which is the layout the owner approved (prototype/stretch-suggestions-408, layout B).
// tailor-journey.mjs keeps the phone and the exits; this one owns the suggestion flow.
//
//   PORT=34181 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34181 npx next build && npx next start -p 34180
//   BASE_URL=http://127.0.0.1:34180 node apps/web/e2e/stretch-use-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `stretch-use-${Date.now()}@example.com`;

const USE = 'Use for this job';
const APPROVE = 'Approve and email me this CV';
const DONE = 'Done — your CV is made and the email is on its way.';

const qa = await createSession('stretch-use-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;

// Record a pass/fail into the report without aborting the run, so one defect never costs us the
// evidence for every later step. '' is always contained (pass); the sentinel never is (fail).
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const pct = async () => {
  const label = await page.locator('.dbar .score').getAttribute('aria-label');
  return Number(label.replace(/\D/g, ''));
};
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------------------------------------
// 0. Seed the session the way tailor-journey.mjs does: real API calls made IN-PAGE (the session
//    cookie is Secure), her reviewed CV for facts, the real magic-link sign-in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await page.waitForTimeout(700);
await page.evaluate(
  async ({ role }) =>
    fetch('/api/onboarding/discovery/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then(() => undefined),
  { role: ROLE },
);
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
await qa.note(`her CV was read and reviewed — ${facts} facts on her record`);
const seeded = await page.evaluate(async ({ email }) => {
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
  const token = new URL('http://x' + link.devLink).searchParams.get('token');
  await post('/api/auth/verify', { token });
  return 'ok';
}, { email: EMAIL });
if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);

// ---------------------------------------------------------------------------------------------
// 1. Pick a job: the reveal -> the deck -> swipe right -> /tailor.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: the first card renders with its score');
const deckTitle = (await page.locator('.jobcard h2').first().textContent()).trim();
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), `DECK: I want this one ("${deckTitle}")`);
await page.waitForURL('**/tailor', { timeout: 15_000 });
await qa.expectVisible('.jobdeck.tailor', 'the bridge navigated to /tailor');

// ---------------------------------------------------------------------------------------------
// 2. The draft is first (ADR-0020 clause 1): no question about the job; a profile question this
//    job may leave open is answered once; then the CV is written and shown — before the stretch
//    step has finished (the fix carried from #417: the finished draft is never hidden behind it).
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question this job left open — answer it once');
  await page.waitForTimeout(1400);
}
await assert((await page.locator('.tailor .ask .q').count()) === 0, 'ADR-0020 clause 1: nothing is asked about the job itself');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is the page — written by itself, without a press');
await qa.expectVisible(page.getByRole('heading', { name: deckTitle }), `the job heads the screen ("${deckTitle}")`);
const before = await api('/api/onboarding/tailor');
const pctBefore = await pct();
await assert(pctBefore === before.card.matchPct, `the ring shows the server's number (${pctBefore}%)`);
await qa.note(`requirements before: ${JSON.stringify(before.requirements.map((r) => `${r.state}: ${r.text.slice(0, 40)}`))}`);

// ---------------------------------------------------------------------------------------------
// 3. A suggestion opens by itself beside the draft, previewed in place.
// ---------------------------------------------------------------------------------------------
const card = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await card.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible(card, 'the first stretch suggestion is open in the rail (the step ran after the draft)');
const view = await api('/api/onboarding/tailor/draft');
await assert(view.stretch?.status === 'ran' && view.stretch.suggestions.length > 0, `API: the step ran and found ${view.stretch?.suggestions?.length ?? 0} suggestion(s)`);
let s = view.stretch.suggestions[0];
const requirement = before.requirements.find((r) => r.id === s.requirementId);
await qa.note(`suggestion 1 — requirement "${requirement?.text}" (${requirement?.state}) · line in "${s.claimText}" · line out "${s.lineOut}"`);
await assert(requirement && requirement.state !== 'met', 'the suggestion answers a requirement the CV does not meet');
await qa.expectVisible(card.getByText(s.why), 'the card says why it fired');
await qa.expectVisible(card.getByText(s.interviewNarrative), 'and what to say if asked');
const srcBefore = await page.locator('.draft-frame').getAttribute('srcdoc');
await assert(srcBefore.includes(`<del>${esc(s.lineOut)}</del>`) && srcBefore.includes(`<ins>${esc(s.claimText)}</ins>`), 'the swap previews IN PLACE on the draft: the line out struck, the line in marked');
const useButton = card.getByRole('button', { name: new RegExp(`^${USE}`) });
await qa.expectVisible(useButton, '"Use for this job" is the gold primary');
await assert(/\bgold\b/.test(await useButton.getAttribute('class')), 'gold, as the owner approved');
await assert(!/\+\d+%/.test(await page.locator('.tailor').innerText()), 'no "+N%" anywhere before the answer');

// ---------------------------------------------------------------------------------------------
// 3b. #420 Edit wording: E starts the edit IN PLACE on the draft (a computer), the line is typed
//     where it stands, Esc ends it — and what to say if asked comes back rewritten for the edited
//     line (qa-main's re-say fake derives it from the line it is handed). The rest of the journey
//     then carries the edited line: Use prints it, the summary explains it, the reload keeps it.
// ---------------------------------------------------------------------------------------------
const EDITED = `${s.claimText}, across three vendor teams`;
await qa.press(card.getByRole('heading'), 'e', 'E — edit the wording of the open suggestion');
const line = page.frameLocator('.draft-frame').locator('ins');
await qa.expectVisible(line, 'the line in is editable where it stands on the draft');
await assert((await line.getAttribute('contenteditable')) === 'true', 'in place on the draft, not in a separate field');
await qa.expectText(card, 'We will rewrite this to match your wording.', 'the old interview line is not shown beside a sentence being edited');
await qa.fill(line, EDITED, 'type the new wording into the line');
await qa.press(line, 'Escape', 'Esc ends the edit');
const SAID = `If they ask, I explain the work behind it: ${EDITED}`;
await card.getByText(SAID).waitFor({ timeout: 15_000 }).catch(() => {});
await qa.expectText(card, SAID, 'what to say if asked is rewritten for the edited line');
const edited = (await api('/api/onboarding/tailor/draft')).stretch.suggestions.find((x) => x.id === s.id);
await assert(edited.claimText === EDITED && edited.interviewNarrative === SAID, 'API: the suggestion stores the edited line with its own interview line');
await assert(!(await page.locator('.tailor').innerText()).includes(s.interviewNarrative), 'the old interview line is gone from the screen');
await assert((await page.locator('.draft-frame').getAttribute('srcdoc')).includes(`<ins>${esc(EDITED)}</ins>`), 'the draft previews the edited line in place');
s = edited;

// ---------------------------------------------------------------------------------------------
// 4. Use for this job: the line lands on the CV, the score moves, the requirement reads met by a
//    stretch — on this job only.
// ---------------------------------------------------------------------------------------------
await qa.click(useButton, 'Use for this job');
await page.locator('.dbar .score').locator('xpath=self::*[not(@aria-label="' + pctBefore + '% match")]').waitFor({ timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(1600); // the mote (720ms) + the roll-up — let the beat finish before reading
const after = await api('/api/onboarding/tailor');
const pctAfter = await pct();
await qa.note(`score ${pctBefore}% → ${pctAfter}% (server ${before.card.matchPct}% → ${after.card.matchPct}%)`);
await assert(after.card.matchPct > before.card.matchPct, 'API: this job\'s % rose');
await assert(pctAfter === after.card.matchPct, 'the ring landed on the server\'s new number');
await assert(after.requirements.find((r) => r.id === s.requirementId)?.state === 'stretched', 'API: the requirement reads "stretched"');
await assert(!/\+\d+%/.test(await page.locator('.tailor').innerText()), 'still no "+N%" anywhere — the number is the statement');
await qa.expectText('.tailor [aria-live="polite"]', `Match now ${after.card.matchPct}%`, 'the change is announced to a screen reader');
await assert((await page.locator('.mote').count()) === 0, 'the mote is gone once it has landed');
const srcAfter = await page.locator('.draft-frame').getAttribute('srcdoc');
await assert(srcAfter.includes(`<li>${esc(s.claimText)}</li>`) && !srcAfter.includes(esc(s.lineOut)), 'the CV now carries the edited line, word for word, where the line out was');
await assert(!(await page.locator('.tailor .gaps').innerText().catch(() => '')).includes(requirement.text), '"Also asked, not on your CV" no longer names it');

const met = after.requirements.filter((r) => r.state === 'met' || r.state === 'stretched').length;
await qa.click(page.getByRole('button', { name: `Where you fit · ${met} of ${after.requirements.length}` }), 'open "Where you fit"');
const sheet = page.getByRole('dialog', { name: /Where you fit/ });
await qa.expectVisible(sheet, 'the sheet opens');
const row = sheet.locator('.marks li[data-state="stretched"]');
await qa.expectText(row.locator('.t'), requirement.text, 'the requirement is in the sheet');
await qa.expectText(row.locator('.s'), 'met by a stretch', 'and reads "met by a stretch" — never a plain match');
await page.keyboard.press('Escape');

// ---------------------------------------------------------------------------------------------
// 5. "Ready to send": the answer listed with its own Undo; what to be ready to explain.
// ---------------------------------------------------------------------------------------------
await page.keyboard.press('Escape'); // close the open card (the next suggestion opened by itself)
const summary = page.getByRole('region', { name: /Ready to send|not used — your CV keeps its own lines/ });
await qa.expectVisible(summary, '"Ready to send" is the rail once no card is open');
await qa.expectText(summary, '1 used for this job', 'it counts the answer');
const usedRow = summary.getByRole('listitem').filter({ hasText: requirement.text });
await qa.expectText(usedRow, 'Used for this job', 'the row says what the answer was');
await qa.expectVisible(usedRow.getByRole('button', { name: 'Undo' }), 'with its own Undo');
await qa.expectText(summary, s.interviewNarrative, '"Be ready to explain" carries the interview line');

// ---------------------------------------------------------------------------------------------
// 6. Approve: one press -> Done. The used line is in the document that left (the API test proves
//    the bullet and the report's section 4 word for word; here the press completes with it).
// ---------------------------------------------------------------------------------------------
const reportCallsBefore = (await api('/api/qa/llm-calls')).report ?? 0;
await qa.click(page.getByRole('button', { name: APPROVE }), 'Approve and email me this CV');
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, 'Done — the document is made and the email is on its way');
const reportCalls = (await api('/api/qa/llm-calls')).report ?? 0;
await assert(reportCalls === reportCallsBefore + 1, `one report call was spent (${reportCallsBefore} → ${reportCalls})`);

// ---------------------------------------------------------------------------------------------
// 7. Reload: the answer is a record beside the draft — the number and the line survive.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await assert((await pct()) === after.card.matchPct, `the number survived the reload (${after.card.matchPct}%)`);
const srcReload = await page.locator('.draft-frame').getAttribute('srcdoc');
await assert(srcReload.includes(`<li>${esc(s.claimText)}</li>`), 'the used line is still on the CV');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
