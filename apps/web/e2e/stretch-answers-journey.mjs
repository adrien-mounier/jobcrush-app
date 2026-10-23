// Spec #412 (ADR-0020) — QA's whole-spec drive of the Tailor screen, human-paced, over a REAL stack
// (qa-main's fake model; no ANTHROPIC_API_KEY). stretch-use-journey.mjs owns Use + Edit at a
// computer; this one walks every OTHER answer, both widths, and the cross-screen numbers:
//
//   COMPUTER (1280px), job A: the draft first, no requirement question → the Match breakdown under
//   the header, above "Read the ad in full" (#411) → "Also asked, not on your CV" (no button) →
//   "Where you fit" as a side sheet, in the job's order → suggestion 1 previewed in place, the other
//   a margin numeral → Edit wording, emptied: the wording is kept and the card says so (#420) →
//   "It's true" on its own row → a toast with Undo → Undo is quiet → It's true again (key T) →
//   suggestion 2: Use (key U) — the reward beat, no "+N%", met by a stretch → the deck list shows
//   the Tailor screen's % → Undo from "Ready to send" is quiet → Use again → Approve → an Undo after
//   approval is refused → the profile shows the It's-true line under the job's employer, tagged,
//   with the line it pushed out still there.
//
//   PHONE (390px), job B — a job he PASTES (a found job has no screen of its own): its screen →
//   Write the tailored CV → the draft first, the breakdown heading the column → one suggestion at a
//   time, answers stacked, "Skip the rest" → Edit wording on the card (E / Esc), what to say
//   rewritten → No (key N) → job A's used-for-this-job skill is not on job B's CV → Use on the next
//   → the job's own screen shows the Tailor screen's % and "met by a stretch" → "Ready to send" →
//   "Where you fit" as a pull-up → Approve.
//
//   PORT=34221 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34221 npx next build && npx next start -p 34220
//   BASE_URL=http://127.0.0.1:34220 node apps/web/e2e/stretch-answers-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = `stretch-answers-${Date.now()}@example.com`;
const APPROVE = 'Approve and email me this CV';
const DONE = 'Done — your CV is made and the email is on its way.';
const TRUE = "It's true: keep it on my CV for every job";

const qa = await createSession('stretch-answers-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const pct = async () => Number((await page.locator('.dbar .score').getAttribute('aria-label')).replace(/\D/g, ''));
const src = () => page.locator('.draft-frame').getAttribute('srcdoc');
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rect = (l) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; });
/** The paper column's blocks in page order (it scrolls under a sticky header, so order, not y). */
const paperOrder = () =>
  page.locator('.paper-col').evaluate((col) =>
    [...col.querySelectorAll('.ageing, .breakdown, .draft-frame, details, summary, button')]
      .map((el) => (el.matches('.ageing') ? 'ageing' : el.matches('.breakdown') ? 'breakdown' : el.matches('.draft-frame') ? 'draft' : /Read the ad in full/.test(el.textContent) ? 'ad-in-full' : null))
      .filter((v, i, a) => v && a.indexOf(v) === i));
/** Watches for the toast for `ms`: when it first showed, its text, how long it stayed. */
const watchToast = (ms) =>
  page.evaluate(async (ms) => {
    const seen = { firstAt: null, lastAt: null, text: '', undo: false };
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const t = document.querySelector('.tailor .toast');
      if (t) {
        const at = Math.round(performance.now() - t0);
        if (seen.firstAt === null) seen.firstAt = at;
        seen.lastAt = at;
        seen.text = t.textContent;
        seen.undo = !!t.querySelector('button');
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return seen;
  }, ms);
const tailorText = () => page.locator('.tailor').innerText();
/** Samples the score ring for `ms`: did a mote fly, did the ring bump or glow, which numbers showed. */
const watchBeat = (ms) =>
  page.evaluate(async (ms) => {
    const seen = { mote: false, bumped: false, lit: false, numbers: [] };
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const ring = document.querySelector('.dbar .score');
      if (document.querySelector('.mote')) seen.mote = true;
      if (ring?.classList.contains('bumped')) seen.bumped = true;
      if (ring?.classList.contains('lit')) seen.lit = true;
      const n = Number(ring?.querySelector('.n')?.textContent.replace(/\D/g, ''));
      if (seen.numbers.at(-1) !== n) seen.numbers.push(n);
      await new Promise((r) => setTimeout(r, 25));
    }
    return seen;
  }, ms);

// ---------------------------------------------------------------------------------------------
// 0. Seed: an anonymous session, her CV read and reviewed, the real magic-link sign-in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery');
await page.waitForTimeout(700);
await page.evaluate(async () =>
  fetch('/api/onboarding/discovery/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'IT project manager in Paris' }) }).then(() => undefined),
);
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
const seeded = await page.evaluate(async ({ email }) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const link = await (await post('/api/auth/request-link', { email })).json();
  if (!link.devLink) return 'no dev link';
  await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return 'ok';
}, { email: EMAIL });
if (seeded !== 'ok') throw new Error(`could not sign in: ${seeded}`);
await qa.note(`signed in as ${EMAIL}; ${facts} facts on her record`);

async function pickJob(label) {
  await qa.goto('/deck', `${label}: the deck`);
  const seeThem = page.getByRole('button', { name: 'See them' });
  if (await seeThem.count()) await qa.click(seeThem, 'See them');
  await qa.expectVisible(page.getByRole('img', { name: /% match/ }).first(), `${label}: a card with its score`);
  const title = (await page.locator('.jobcard h2').first().textContent()).trim();
  await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), `${label}: I want this one ("${title}")`);
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await page.waitForTimeout(800);
  if ((await page.locator('.tailor .ask .q').count()) > 0) {
    await qa.click(page.locator('.tailor .opts .opt').first(), `${label}: a profile question (work rights / language) — answered once`);
    await page.waitForTimeout(1400);
  }
  await assert(!(await tailorText()).includes('Does that describe you'), `${label}: no requirement is ever asked as yes/no`);
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible('.draft-frame', `${label}: the draft is the page — written by itself`);
  return title;
}

// =============================================================================================
// COMPUTER — job A
// =============================================================================================
const titleA = await pickJob('JOB A (computer)');
const stA = await api('/api/onboarding/tailor');
const adA = stA.card.adId;
await qa.note(`job A ${adA}: ${stA.card.matchPct}% · requirements ${JSON.stringify(stA.requirements.map((r) => `${r.state}: ${r.text}`))}`);
const oldAnswer = await page.evaluate(async (id) => (await fetch('/api/onboarding/tailor/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requirementId: id, answer: 'yes' }) })).status, stA.requirements[0]?.id);
await assert(oldAnswer === 404, `#415: the requirement answer route is gone (HTTP ${oldAnswer})`);

// #411: the Match breakdown under the header, above "Read the ad in full", above the draft.
const adBtn = page.locator('.paper-col').getByText('Read the ad in full', { exact: true }).first();
await qa.expectVisible(page.locator('.paper-col .breakdown'), '#411: the Match breakdown on the Tailor screen');
const colOrder = await paperOrder();
await qa.note(`the paper column under the header, top to bottom: ${colOrder.join(' → ')}`);
await assert(colOrder[0] === 'breakdown' && colOrder[1] === 'ad-in-full' && colOrder[2] === 'draft',
  '#411: under the header the Match breakdown, then Read the ad in full, then the draft');
await qa.expectVisible(adBtn, '#411: "Read the ad in full" is kept on the Tailor screen, under the breakdown');
await assert((await page.locator('.paper-col .ageing').count()) === 0, 'no ageing line on a job found today (it shows only for a pasted job from day seven)');
await qa.scrollThrough('read the draft page top to bottom');

// "Also asked, not on your CV": the gap rows, in the job's order, with no button.
const gapsA = stA.requirements.filter((r) => r.state === 'gap').map((r) => r.text);
if (gapsA.length) {
  const gaps = page.locator('.tailor .gaps');
  await qa.expectVisible(gaps, '"Also asked, not on your CV" sits in the rail');
  const shown = await gaps.locator('.gaplist li').allInnerTexts();
  await assert(JSON.stringify(shown) === JSON.stringify(gapsA), `it lists the unmet requirements in the job's order (${shown.length})`);
  await assert((await gaps.locator('button, a').count()) === 0, 'it has no button');
} else await qa.note('job A has no gap rows — the list is honestly absent');

// "Where you fit" as a side sheet.
await qa.click(page.getByRole('button', { name: /^Where you fit · / }), 'open "Where you fit"');
const sheet = page.getByRole('dialog', { name: /Where you fit/ });
await qa.expectVisible(sheet, 'the sheet opens');
const sr = await rect(page.locator('.sheet'));
await assert(sr.right >= 1279 && sr.w < 700 && sr.h >= 700, `a side sheet on a computer: right-anchored, ${Math.round(sr.w)}px wide, ${Math.round(sr.h)}px tall`);
const order = await sheet.locator('.marks li .t').allInnerTexts();
await assert(JSON.stringify(order) === JSON.stringify(stA.requirements.map((r) => r.text)), "in the job's own order, never re-sorted");
await qa.click(sheet.getByRole('button', { name: 'Close' }), 'Close the sheet');

// Suggestion 1, previewed in place; the other a margin numeral.
const card1 = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await card1.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible(card1, 'suggestion 1 opens beside the draft');
let view = await api('/api/onboarding/tailor/draft');
const [s1, s2] = view.stretch.suggestions;
await qa.note(`suggestions: ${view.stretch.suggestions.map((s) => `${s.id} [${s.slot.kind}] "${s.claimText}" ← "${s.lineOut ?? '—'}"`).join(' | ')}`);
let html = await src();
await assert(html.includes(`<del>${esc(s1.lineOut)}</del>`) && html.includes(`<ins>${esc(s1.claimText)}</ins>`), 'in place on the draft: the line out struck, the line in marked');
await assert(s2 ? /class="pin" aria-hidden="true">2</.test(html) : true, 'the other suggestion shows as a margin numeral');
await assert(!/\+\d+%/.test(await tailorText()), 'no "+N%" anywhere');

// #420: Edit wording, emptied → the suggestion's wording is kept, and the card says so.
await qa.click(card1.getByRole('button', { name: /^Edit wording/ }), 'Edit wording');
const ins = page.frameLocator('.draft-frame').locator('ins');
await assert((await ins.getAttribute('contenteditable')) === 'true', 'the line is edited where it stands on the draft');
await qa.fill(ins, '', 'empty the line');
await qa.press(ins, 'Escape', 'Esc ends the edit');
await qa.expectText(card1, 'An empty line cannot go on your CV, so we kept the suggested wording.', 'an emptied edit keeps the wording and SAYS so');
view = await api('/api/onboarding/tailor/draft');
await assert(view.stretch.suggestions[0].claimText === s1.claimText, 'API: the stored line in is unchanged');
await assert((await src()).includes(`<ins>${esc(s1.claimText)}</ins>`), 'the draft previews the suggested wording again');

// #419: "It's true" on its own row, apart from Use.
const useBtn = card1.getByRole('button', { name: /^Use for this job/ });
const trueBtn = card1.getByRole('button', { name: new RegExp(`^${TRUE}`) });
const ru = await rect(useBtn);
const rt = await rect(trueBtn);
await qa.expectVisible(trueBtn, `"${TRUE}"`);
await assert(rt.y >= ru.bottom - 1, `"It's true" sits on its own row, below Use (Use ends ${Math.round(ru.bottom)}, It's true starts ${Math.round(rt.y)})`);
const pctA0 = await pct();
const toastWatch = watchToast(7000);
await trueBtn.click();
await page.waitForTimeout(300);
await qa.expectVisible(page.locator('.tailor .toast'), "It's true pressed — a toast confirms it");
const tw = await toastWatch;
await qa.note(`toast watch: first seen at ${tw.firstAt}ms, last at ${tw.lastAt}ms, "${tw.text}", Undo button ${tw.undo}`);
await assert(tw.firstAt !== null && tw.undo, 'the toast showed, carrying Undo');
let st = await api('/api/onboarding/tailor');
await assert(st.requirements.find((r) => r.id === s1.requirementId)?.state === 'met', 'the requirement reads plainly met — not "met by a stretch"');
await assert((await src()).includes(esc(s1.claimText)) && !(await src()).includes(esc(s1.lineOut)), 'this CV prints the line where the line out was');
const pctTrue = await pct();
await qa.note(`It's true: ${pctA0}% → ${pctTrue}% (server ${st.card.matchPct}%)`);

// Undo from "Ready to send" — quiet. (The toast lasts 5s and the watch above outlived it; the
// toast's own Undo is pressed on the second It's true below.)
await qa.note(`the toast has gone (it lasts 5s): It's true's Undo from "Ready to send"`);
const beat = watchBeat(1800);
await page.evaluate(() => window.scrollTo(0, 0));
await page.keyboard.press('Escape');
await page.getByRole('region', { name: 'Ready to send' }).getByRole('listitem').filter({ hasText: st.requirements.find((r) => r.id === s1.requirementId).text }).getByRole('button', { name: 'Undo' }).click();
const undone = await beat;
await qa.note(`toast Undo: numbers ${JSON.stringify(undone.numbers)}, mote ${undone.mote}, bump ${undone.bumped}, glow ${undone.lit}`);
await assert(!undone.mote && !undone.bumped && !undone.lit, 'Undo is quiet: no mote, no bump, no glow');
st = await api('/api/onboarding/tailor');
await assert(st.card.matchPct === pctA0 && (await pct()) === pctA0, `the score is back (${pctA0}%)`);
await assert((await src()).includes(esc(s1.lineOut)), "this CV's line out is back");
const prof0 = await api('/api/profile');
await assert(!JSON.stringify(prof0).includes(s1.claimText), 'the master CV line is gone');
await qa.expectVisible(card1, 'the suggestion is open again');

// It's true again, by key T.
await card1.getByRole('heading').click();
const toastWatch2 = watchToast(2500);
await page.keyboard.press('t');
const tw2 = await toastWatch2;
await qa.expectVisible(page.locator('.tailor .toast'), "T — It's true, again: the toast again");
await assert(tw2.firstAt !== null, `the toast showed (at ${tw2.firstAt}ms)`);
// Its Undo, pressed while it shows — quiet — then T once more to keep the line.
const beatT = watchBeat(1800);
await page.locator('.tailor .toast').getByRole('button', { name: 'Undo' }).click();
const undoneT = await beatT;
await qa.note(`toast Undo: numbers ${JSON.stringify(undoneT.numbers)}, mote ${undoneT.mote}, bump ${undoneT.bumped}, glow ${undoneT.lit}`);
await assert(!undoneT.mote && !undoneT.bumped && !undoneT.lit && (await pct()) === pctA0, `the toast's Undo is quiet and puts the score back (${pctA0}%)`);
await qa.expectVisible(card1, 'suggestion 1 is open again');
await card1.getByRole('heading').click();
await qa.press(card1.getByRole('heading'), 't', "T — It's true, to keep it");
await page.waitForTimeout(1800);

// Suggestion 2: Use, by key U — the reward beat, no "+N%".
const card2 = page.getByRole('region', { name: /^Suggestion 2 of \d+$/ });
if (s2) {
  await qa.expectVisible(card2, `suggestion 2 opens (${s2.slot.kind}): "${s2.claimText}"`);
  const before = await pct();
  const reward = watchBeat(2200);
  await page.keyboard.press('u');
  const beat2 = await reward;
  await qa.note(`Use: numbers ${JSON.stringify(beat2.numbers)}, mote ${beat2.mote}, bump ${beat2.bumped}, glow ${beat2.lit}`);
  await assert(beat2.mote && beat2.bumped, 'Use plays the reward beat (the mote flies, the ring bumps) — the quiet Undo is a real difference');
  await assert(beat2.numbers.length > 2, 'the number rolls up point by point');
  st = await api('/api/onboarding/tailor');
  const after = await pct();
  await assert(after === st.card.matchPct && after > before, `the score moved ${before}% → ${after}%`);
  await assert(!/\+\d+%/.test(await tailorText()), 'still no "+N%"');
  await qa.expectText('.tailor [aria-live="polite"]', `Match now ${st.card.matchPct}%`, 'the new score is announced');
  await assert(st.requirements.find((r) => r.id === s2.requirementId)?.state === 'stretched', 'API: the requirement reads stretched');
  await qa.click(page.getByRole('button', { name: /^Where you fit · / }), 'open "Where you fit"');
  const row = page.locator('.sheet .marks li', { hasText: st.requirements.find((r) => r.id === s2.requirementId).text });
  await qa.expectText(row.locator('.s'), 'met by a stretch', 'it reads "met by a stretch"');
  const row1 = page.locator('.sheet .marks li', { hasText: st.requirements.find((r) => r.id === s1.requirementId).text });
  await qa.expectText(row1.locator('.s'), 'met', "and the It's-true one reads plainly met");
  await assert((await row1.locator('.s').innerText()) !== 'met by a stretch', "the It's-true row is not labelled a stretch");
  await page.keyboard.press('Escape');

  // The deck list and the job's own screen agree with the Tailor screen.
  const deck = await api('/api/onboarding/cards');
  const deckCard = (deck.cards ?? []).find((c) => c.adId === adA);
  await qa.note(`deck list card for ${adA}: ${deckCard ? deckCard.matchPct + '%' : 'not in the list'} · Tailor ${st.card.matchPct}%`);
  if (deckCard) await assert(deckCard.matchPct === st.card.matchPct, `the deck list shows the Tailor screen's % (${deckCard.matchPct}% = ${st.card.matchPct}%)`);
  else await qa.note('the wanted job is not in the deck list (it left the deck when wanted) — checked on its own screen instead');
  // A found job has no screen of its own (only a pasted one does): job B below covers that screen.
  await qa.goto('/deck', 'the deck, after Use');
  const deckRing = page.locator('.jobcard', { has: page.getByRole('heading', { name: titleA, exact: true }) }).getByRole('img', { name: /% match/ }).first();
  if (await deckRing.count()) {
    const deckPct = Number((await deckRing.getAttribute('aria-label')).replace(/\D/g, ''));
    await qa.expectVisible(deckRing, `the deck card for "${titleA}" shows ${deckPct}%`);
    await assert(deckPct === st.card.matchPct, `the deck card agrees with the Tailor screen (${deckPct}% = ${st.card.matchPct}%)`);
  } else await qa.note(`"${titleA}" is not on top of the deck (it was wanted); the deck list's own % is checked above`);
  await qa.goto('/tailor', 'back to the Tailor screen');
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await assert((await pct()) === st.card.matchPct, 'the number survived the round trip');

  // Undo the Use from "Ready to send": quiet, the line comes off.
  const summary = page.getByRole('region', { name: 'Ready to send' });
  await qa.expectVisible(summary, '"Ready to send" lists the answers');
  await qa.expectText(summary, '1 used for this job', 'one used for this job');
  await qa.expectText(summary, '1 kept on your CV for every job', 'one kept on the CV for every job');
  const usedRow = summary.getByRole('listitem').filter({ hasText: st.requirements.find((r) => r.id === s2.requirementId).text });
  const quiet = watchBeat(1800);
  await usedRow.getByRole('button', { name: 'Undo' }).click();
  const q2 = await quiet;
  await qa.note(`summary Undo: numbers ${JSON.stringify(q2.numbers)}, mote ${q2.mote}, bump ${q2.bumped}, glow ${q2.lit}`);
  await assert(!q2.mote && !q2.bumped && !q2.lit, 'Undo of Use is quiet: no mote, no bump, no glow');
  await assert(q2.numbers.length >= 2 && q2.numbers.at(-1) < q2.numbers[0], `the number counts down (${q2.numbers[0]}% → ${q2.numbers.at(-1)}%)`);
  await qa.expectVisible(card2, 'suggestion 2 is open again');
  await qa.click(card2.getByRole('button', { name: /^Use for this job/ }), 'Use for this job, again');
  await page.waitForTimeout(1800);
}

// Approve.
await page.keyboard.press('Escape');
st = await api('/api/onboarding/tailor');
await qa.click(page.getByRole('button', { name: APPROVE }), 'Approve and email me this CV');
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, 'Done');
const late = await page.evaluate(async (id) => (await fetch(`/api/onboarding/tailor/suggestions/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'undo' }) })).status, s1.id);
await qa.note(`an Undo sent after approval answers HTTP ${late}`);

// The profile: the It's-true line under job A's employer, tagged; the line it pushed out still there.
await qa.goto('/profile', 'the profile (master CV)');
const keptRow = page.locator('.frow', { hasText: s1.claimText }).first();
await keptRow.waitFor({ timeout: 20_000 }).catch(() => {});
await qa.expectVisible(keptRow, "the It's-true line is on the master CV");
const block = page.locator('.jblk', { has: keptRow });
const jhead = (await block.locator('.jhead').count()) ? (await block.locator('.jhead').innerText()).trim() : '(no employer heading)';
await qa.expectVisible(block.locator('.jhead'), `under a job's employer heading: "${jhead}"`);
await qa.expectText(keptRow.locator('.tag.added'), `Added while tailoring for`, 'tagged "Added while tailoring for…"');
await qa.note(`tag: "${await keptRow.locator('.tag.added').innerText().catch(() => '')}"`);
await qa.expectVisible(block.locator('.frow', { hasText: s1.lineOut.slice(0, 30) }).first(), 'the line it pushed out on this CV is still on the master CV, in the same block');

// =============================================================================================
// PHONE (390px) — job B
// =============================================================================================
await page.setViewportSize({ width: 390, height: 844 });
await qa.note('— the phone: 390 × 844 —');
// Job B is one he brings: pasted, so it has a screen of its own (a found job has none).
const ADVERT = [
  `Senior IT Project Manager — Helvara Group ${Date.now()}`,
  'Brussels, Belgium · Hybrid',
  '',
  'What you will do',
  '- Own the end-to-end delivery of a multi-year transformation programme.',
  '- Coordinate business and technical stakeholders and report to the steering committee monthly.',
  '- Manage a budget of EUR 4-6 million and a mixed team of internal staff and external vendors.',
  '- Identify, track and mitigate risks, issues and dependencies across four workstreams.',
  '',
  'What we are looking for',
  '- At least eight years managing IT projects.',
  '- Fluent English.',
  '- Experience of Agile and Scrum delivery, and of PRINCE2 or PMP governance.',
].join('\n');
const adB = await page.evaluate(async (text) => {
  const r = await fetch('/api/onboarding/paste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const { jobId } = await r.json();
  for (let i = 0; i < 400; i++) {
    const job = await (await fetch(`/api/jobs/${jobId}`)).json();
    if (job.status === 'completed' || job.status === 'failed') return job.progress?.paste?.result?.adId ?? null;
    await new Promise((res) => setTimeout(res, 400));
  }
  return null;
}, ADVERT);
await assert(!!adB, `JOB B pasted and read (${adB})`);
await qa.goto(`/job/${encodeURIComponent(adB)}`, 'JOB B (phone): the job he pasted, on its own screen');
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'JOB B: a profile question — answered once');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'JOB B (phone): the draft first');
const stB = await api('/api/onboarding/tailor');
await qa.note(`job B ${stB.card.adId}: ${stB.card.matchPct}% · ${JSON.stringify(stB.requirements.map((r) => `${r.state}: ${r.text}`))}`);
const colB = await paperOrder();
await assert(colB[0] === 'breakdown' || (colB[0] === 'ageing' && colB[1] === 'breakdown'), `#411 on the phone: the breakdown heads the column (${colB.join(' → ')})`);
const cardB = page.locator('.stretch-card');
await cardB.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible(cardB, 'a suggestion card under the draft');
await assert((await page.locator('.stretch-card').count()) === 1, 'one suggestion at a time');
const buttons = cardB.locator('.acts button');
const rs = [];
for (let i = 0; i < (await buttons.count()); i++) rs.push(await rect(buttons.nth(i)));
await assert(rs.length >= 3 && rs[1].y >= rs[0].bottom - 1 && rs[2].y >= rs[1].bottom - 1, `the answers stack (${rs.map((r) => Math.round(r.y)).join(' / ')})`);
await qa.expectVisible(cardB.getByRole('button', { name: 'Skip the rest' }), '"Skip the rest"');
await qa.expectVisible(cardB.locator('.clip'), 'the card carries the swap itself');
const viewB = await api('/api/onboarding/tailor/draft');
const b1 = viewB.stretch.suggestions.find((s) => s.state === 'pending');
await qa.note(`job B suggestions: ${viewB.stretch.suggestions.map((s) => `${s.state} "${s.claimText}"`).join(' | ')}`);

// Edit on the card (E / Esc).
const EDITED = `${b1.claimText} for a regional bank`;
await cardB.locator('h2').click();
await qa.press(cardB.locator('h2'), 'e', 'E — edit on the card (a phone)');
const cardLine = cardB.locator('.clip ins');
await assert((await cardLine.getAttribute('contenteditable')) === 'true', 'the line on the card is editable in place');
await qa.expectText(cardB, 'We will rewrite this to match your wording.', 'what to say waits for the new wording');
await qa.fill(cardLine, EDITED, 'type the new wording');
await qa.press(cardLine, 'Escape', 'Esc ends the edit');
await cardB.getByText(`If they ask, I explain the work behind it: ${EDITED}`).waitFor({ timeout: 15_000 }).catch(() => {});
await qa.expectText(cardB, `If they ask, I explain the work behind it: ${EDITED}`, 'what to say is rewritten for the edited line');

// No (key N).
await qa.press(cardB.locator('h2'), 'n', 'N — No (this job only)');
await page.waitForTimeout(1200);
let vB2 = await api('/api/onboarding/tailor/draft');
const b1after = vB2.stretch.suggestions.find((s) => s.id === b1.id);
await assert(b1after.state === 'declined' && b1after.scope === 'this-job', `API: declined, scoped to this job (${b1after.state}/${b1after.scope})`);
let htmlB = await src();
await assert(!htmlB.includes(esc(EDITED)), 'the declined line is not on the CV');
// The frame previews the OPEN suggestion in place (<ins>…</ins>); job B's own suggestion 2 is the
// same skill, so read the page without its preview mark.
if (s2) await assert(!htmlB.replace(/<ins>[\s\S]*?<\/ins>/g, '').includes(esc(s2.claimText)), `job A's "Use for this job" line ("${s2.claimText}") is not on job B's CV (only previewed as job B's own open suggestion)`);
// The next one: Use, tapped from the stacked answers; then the job's own screen agrees.
const b2 = vB2.stretch.suggestions.find((s) => s.state === 'pending');
if (b2 && (await page.locator('.stretch-card').count())) {
  await qa.click(page.locator('.stretch-card').getByRole('button', { name: /^Use for this job/ }), `Use for this job — "${b2.claimText}"`);
  await page.waitForTimeout(1800);
  const stB2 = await api('/api/onboarding/tailor');
  const pctB = stB2.card.matchPct;
  await assert(pctB > stB.card.matchPct && (await pct()) === pctB, `job B's score moved ${stB.card.matchPct}% → ${pctB}%`);
  await qa.goto(`/job/${encodeURIComponent(adB)}`, 'JOB B: its own screen, after Use');
  const ring = page.getByRole('img', { name: /% match/ }).first();
  await ring.waitFor({ timeout: 25_000 }).catch(() => {});
  const jobPct = Number(((await ring.getAttribute('aria-label').catch(() => '')) ?? '').replace(/\D/g, ''));
  await qa.expectVisible(ring, `the job's own screen shows ${jobPct}%`);
  await assert(jobPct === pctB, `the job's own screen agrees with the Tailor screen (${jobPct}% = ${pctB}%)`);
  await qa.expectVisible(page.locator('.fit-why.stretched').first(), 'its fit row reads met by a stretch');
  await qa.scrollThrough("read the job's screen");
  await qa.goto('/tailor', 'back to the Tailor screen');
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
}
vB2 = await api('/api/onboarding/tailor/draft');
if (await page.locator('.stretch-card').count()) await qa.click(page.locator('.stretch-card').getByRole('button', { name: 'Skip the rest' }), 'Skip the rest');
const sumB = page.getByRole('region', { name: 'Ready to send' });
await qa.expectVisible(sumB, '"Ready to send"');
await qa.expectText(sumB, 'Not for this job', 'the No reads "Not for this job"');
const leftOut = vB2.stretch.suggestions.filter((s) => s.state === 'pending').length;
if (leftOut) await qa.expectText(sumB, 'Not answered, left out', 'the unanswered one reads "left out"');

// "Where you fit" as a pull-up.
await qa.click(page.getByRole('button', { name: /^Where you fit · / }), 'open "Where you fit"');
const pr = await rect(page.locator('.sheet'));
await qa.expectVisible(page.locator('.sheet'), 'the sheet opens');
await assert(Math.abs(pr.bottom - 844) <= 2 && pr.w >= 388, `a pull-up on a phone: full width (${Math.round(pr.w)}px), docked at the bottom (${Math.round(pr.bottom)})`);
await qa.click(page.locator('.sheet').getByRole('button', { name: 'Close' }), 'Close');

// Approve: the declined line does not print.
htmlB = await src();
await assert(!htmlB.includes(esc(EDITED)), 'the declined line is still off the CV');
await qa.click(page.getByRole('button', { name: APPROVE }), 'Approve and email me this CV');
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, 'Done');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
