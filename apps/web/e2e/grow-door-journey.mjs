// #311 "A 'No' never prints, and growing is one step" — the live journey, human-paced, over a REAL
// stack (no route mocks): answer a requirement "No" -> the denial is named under "You told me you
// don't have this" with its "Changed? Add it" door -> open the door, answer a coarse date -> the
// dated fact lands in "Where you fit" and the row leaves -> a second "No" stays -> the draft is
// written and never states the denials' own words.
//
// tailor.spec.ts's "#311 the door" tests pin the same screen against stubbed states; this flow is
// what proves the server half (the old "No" kept, the dated fact, the never-print list) end to end.
//
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/grow-door-journey.mjs
//
// Needs a drafting model behind the API (the fake-model QA stack is enough — it spends nothing).

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `grow-door-${Date.now()}@example.com`;
const DENIED_H = "You told me you don't have this";
const DOOR = 'Changed? Add it';

const qa = await createSession('grow-door-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const asking = async () =>
  ((await page.locator('.tailor .q').textContent()).match(/"([^"]+)"/)?.[1] ?? '').replace(/\.$/, '');

async function readThrough(note) {
  await qa.note(note);
  await page.evaluate(async () => {
    const el = document.querySelector('.live-wrap');
    if (!el) return;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
    el.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------------------------
// 0. Seed: discovery, his CV's facts, real magic-link sign-in. #339: discovery takes no "No" any
//    more (it asks no floor), so every denial in this run is a tailor "No" — §2 makes the first.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
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
await qa.note(`his CV was read and reviewed — ${facts} facts for the draft to work from`);
const signedIn = await page.evaluate(async ({ email }) => {
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
  await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return 'ok';
}, { email: EMAIL });
if (signedIn !== 'ok') throw new Error(signedIn);

// ---------------------------------------------------------------------------------------------
// 1. The deck: the door belongs with the questions, never on a deck card.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the deck card renders');
await qa.expectVisible(page.locator('.jobdeck'), `the deck card carries no "${DOOR}" door (count: ${await page.getByRole('button', { name: DOOR }).count()})`);
await assert((await page.getByRole('button', { name: DOOR }).count()) === 0, 'no door on the deck — it belongs with the questions');
await qa.scrollThrough('read the deck card top to bottom');

await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — I want this one');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.locator('.tailor .q').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
await qa.expectVisible('.tailor .q', 'the Tailor step asks its first question');

// ---------------------------------------------------------------------------------------------
// 2. Answer "No" -> named under "You told me you don't have this", with its door.
// ---------------------------------------------------------------------------------------------
const grown = await asking();
await qa.click(page.getByRole('button', { name: 'No', exact: true }), `answer "No" to "${grown}"`);
await page.waitForTimeout(1400);
await qa.expectVisible(page.getByRole('heading', { name: DENIED_H }), `the heading "${DENIED_H}"`);
const deniedRow = page.locator('.tailor .row.settled').filter({ hasText: grown });
await qa.expectVisible(deniedRow, 'the "No" is named on this card as a dim-dot row');
await qa.expectVisible(deniedRow.getByRole('button', { name: DOOR }), `the row carries its "${DOOR}" door`);
// #311: that "No" is named only on postings that ask for it — never recited on every deck card.
const cards = (await api('/api/onboarding/cards')).cards ?? [];
const naming = cards.filter((c) => (c.askedClosed ?? []).length > 0).length;
await qa.note(`deck after the "No": ${naming} of ${cards.length} cards name a denial (#311: only where the posting asks)`);
await assert(cards.length > 0 && naming < cards.length, `the denial is not recited on every card (${naming}/${cards.length})`);

// ---------------------------------------------------------------------------------------------
// 3. Open the door: the row becomes a question in the same dock; answer a coarse date.
// ---------------------------------------------------------------------------------------------
await qa.click(deniedRow.getByRole('button', { name: DOOR }), `tap "${DOOR}"`);
await qa.expectText('#tailor-ask-q', 'Changed? Since when?', 'the door asks WHEN, in the question dock');
await qa.expectVisible(page.getByRole('button', { name: 'This year' }), 'coarse choice: This year');
await qa.expectVisible(page.getByRole('button', { name: '3 or more years ago' }), 'coarse choice: 3 or more years ago');
await qa.expectVisible(page.getByRole('button', { name: 'No change' }), 'a way out: No change');
const year = new Date().getFullYear() - 1;
await qa.click(page.getByRole('button', { name: '1-2 years ago' }), 'answer "1-2 years ago"');
await page.waitForTimeout(1400);

const fitRow = page.locator('.tailor .row.fit').filter({ hasText: `(since ${year})` });
await qa.expectVisible(fitRow, `the dated fact lands in "Where you fit" — "(since ${year})", the conservative year`);
await assert((await deniedRow.count()) === 0, `the denial row for "${grown}" left the card (count: ${await deniedRow.count()})`);
await qa.expectText('.tailor .ledger', '+', 'the grow earns its ledger line');
const stateAfterGrow = await api('/api/onboarding/tailor');
await assert(
  !stateAfterGrow.doors.some((d) => stateAfterGrow.card.askedClosed.every((r) => r.id !== d.claimId)),
  'every door sits on a named row (none orphaned)',
);
await assert(
  !stateAfterGrow.questions.some((q) => q.text?.includes?.(grown)),
  'the grown requirement is not asked again',
);

await qa.goto('/tailor', 'reload — the grow is stored, not screen state');
await page.waitForTimeout(900);
await qa.expectVisible(page.locator('.tailor .row.fit').filter({ hasText: `(since ${year})` }), 'the dated fact survived the reload');

// ---------------------------------------------------------------------------------------------
// 4. A second "No" that stays; "No change" leaves it standing.
// ---------------------------------------------------------------------------------------------
let kept = '';
if ((await page.locator('.tailor .q').count()) > 0) {
  kept = await asking();
  await qa.click(page.getByRole('button', { name: 'No', exact: true }), `answer "No" to "${kept}" — this one stays`);
  await page.waitForTimeout(1400);
  const keptRow = page.locator('.tailor .row.settled').filter({ hasText: kept });
  await qa.click(keptRow.getByRole('button', { name: DOOR }), `open its door, then think better of it`);
  await qa.click(page.getByRole('button', { name: 'No change' }), 'No change');
  await qa.expectVisible(keptRow, 'his "No" stands after "No change"');
}

// ---------------------------------------------------------------------------------------------
// 5. The draft: written after the questions, and never stating a denial's own words.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), "I'm done — use this CV");
await qa.expectVisible(
  page.getByRole('heading', { name: 'This CV is as strong as I can make it for this job.' }),
  'the ending',
);
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the CV draft is written and shown');
await readThrough('read the finished draft');

const draft = await api('/api/onboarding/tailor/draft');
const html = String(draft.html ?? '').toLowerCase();
await qa.note(`draft status=${draft.status ?? '?'} · html length=${html.length} · notices=${JSON.stringify(draft.conservationNotices ?? [])}`);
if (kept) {
  await assert(!html.includes(kept.toLowerCase()), `the kept denial's words "${kept}" are NOT on the draft page`);
}
await assert(!html.includes('not applicable'), 'no answer scaffolding ("Not applicable") on the draft page');
await qa.note(`the grown fact "(since ${year})" on the draft page: ${html.includes(`since ${year}`)}`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
