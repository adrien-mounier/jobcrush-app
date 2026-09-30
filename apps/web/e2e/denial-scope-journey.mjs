// #311 QA-gate defect 1 regression — "a denied capability is named only on the postings that
// actually ask for it", live and human-paced over a REAL stack (no route mocks):
//   1. a "No" to a Delivery-Manager-title requirement on one job is NOT recited on another job that
//      merely shares the word "delivery" ("...and delivery discipline") — no row, no door, on screen;
//   2. on the job where he said it, the row keeps "You told me you don't have this.";
//   3. a "No" whose words another posting genuinely shares (risk management) IS still named there,
//      and that word-matched door quotes HIS words ("You said no to: ...") — never claims he denied
//      the requirement shown.
//
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/denial-scope-journey.mjs
//
// Needs the sample-ad-requirements fixture postings in the deck (the fake-model QA stack has them).

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `denial-scope-${Date.now()}@example.com`;
const DENIED_H = "You told me you don't have this";
const DOOR = 'Changed? Add it';
const DM_TITLE = 'Prior title of Delivery Manager or equivalent';
const GOV = 'Drive governance, benefit realisation, and delivery discipline';
const RISK = 'Identify, analyze, and mitigate project risks';

const qa = await createSession('denial-scope-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const call = (path, body) =>
  page.evaluate(
    async ([p, b]) => {
      const res = await fetch(p, b === undefined ? {} : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [path, body],
  );
const tailor = async () => (await call('/api/onboarding/tailor')).json;
const want = async (adId) => call(`/api/onboarding/cards/${encodeURIComponent(adId)}/want`, {});
const reqIds = (state) => [
  ...(state.card?.fit ?? []), ...(state.card?.askedClosed ?? []), ...(state.questions ?? []),
].map((x) => JSON.stringify(x)).join(' ');

// 0. Seed: discovery floor (no discovery "No" — keeps the only denials the ones under test), sign in.
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await call('/api/onboarding/discovery/start', { role: ROLE });
const seeded = await qa.seedFloorAnswers({ yes: 'Yes, over $1M' });
if (seeded.length === 0) throw new Error('no floor questions served');
const link = (await call('/api/auth/request-link', { email: EMAIL })).json;
if (!link?.devLink) throw new Error(`sign-in failed: ${JSON.stringify(link)}`);
await call('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });

await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
const cards = (await call('/api/onboarding/cards')).json?.cards ?? [];
await qa.note(`deck has ${cards.length} cards: ${cards.map((c) => c.adId).join(', ')}`);

// Find the two postings by their requirement wording (ids are hashes; wording is the fixture's).
let jobA = null; // asks for a Delivery Manager title
let jobB = null; // asks "delivery discipline", NOT a DM title
let jobR = null; // another posting asking about project risks (for the legit-naming check)
for (const c of cards) {
  await want(c.adId);
  const s = await tailor();
  const text = reqIds(s);
  if (!jobA && text.includes('delivery-manager-title')) jobA = c.adId;
  else if (!jobB && text.includes(GOV) && !text.includes('delivery-manager-title')) jobB = c.adId;
}
await qa.note(`job A (DM title) = ${jobA} · job B (delivery discipline) = ${jobB}`);
if (!jobA || !jobB) throw new Error('fixture postings not found in the deck');

// 1. "I want this one" on A, answer "No" to the Delivery Manager title — on screen.
await want(jobA);
await qa.goto('/tailor', 'Tailor step for job A (asks for a Delivery Manager title)');
const ans = await call('/api/onboarding/tailor/answer', { requirementId: 'delivery-manager-title', answer: 'No' });
await qa.note(`answered "No" to "${DM_TITLE}" on job A → ${ans.status}`);
await qa.goto('/tailor', 'reload job A');
await page.waitForTimeout(900);
const rowA = page.locator('.tailor .row.settled').filter({ hasText: 'Delivery Manager' });
await qa.expectVisible(rowA, 'job A: his "No" is named on the job he said it on');
await qa.click(rowA.getByRole('button', { name: DOOR }), `job A: open "${DOOR}"`);
await qa.expectText('#tailor-ask-q', "You told me you don't have this.", 'job A (id-matched): door says "You told me you don\'t have this."');
await qa.click(page.getByRole('button', { name: 'No change' }), 'No change');

// 2. The repro: job B must NOT name the Delivery-Manager "No" — no row, no door.
await want(jobB);
const sB = await tailor();
await qa.note(`GET /tailor on job B: askedClosed=${JSON.stringify(sB.card?.askedClosed)} doors=${JSON.stringify(sB.doors)}`);
await assert((sB.card?.askedClosed ?? []).length === 0, 'API: job B askedClosed is empty');
await assert((sB.doors ?? []).length === 0, 'API: job B has no door');
await qa.goto('/tailor', 'Tailor step for job B (delivery discipline, no DM title)');
await page.waitForTimeout(900);
await qa.scrollThrough('read job B top to bottom');
await qa.expectVisible(page.locator('.tailor').getByText(GOV).first(), `job B shows its requirement "${GOV}"`);
const headB = await page.getByRole('heading', { name: DENIED_H }).count();
const doorB = await page.getByRole('button', { name: DOOR }).count();
const dmB = await page.locator('.tailor').getByText('Delivery Manager').count();
await qa.expectVisible('.tailor', `job B on screen: "${DENIED_H}" heading ×${headB}, "${DOOR}" ×${doorB}, "Delivery Manager" ×${dmB}`);
await assert(headB === 0 && doorB === 0 && dmB === 0, 'job B: the Delivery-Manager "No" is NOT named, no door');

// 3. Legit naming: a "No" to project risks on job A is still named on other risk-asking postings,
//    and the word-matched door quotes his own words.
await want(jobA);
const riskAns = await call('/api/onboarding/tailor/answer', { requirementId: 'identify-mitigate-risks', answer: 'No' });
await qa.note(`answered "No" to "${RISK}" on job A → ${riskAns.status}`);
const naming = [];
for (const c of (await call('/api/onboarding/cards')).json?.cards ?? []) {
  const rows = (c.askedClosed ?? []).map((r) => r.text ?? r.requirement ?? JSON.stringify(r));
  if (rows.length) naming.push(`${c.adId}: ${rows.join(' / ')}`);
  if (c.adId !== jobA && c.adId !== jobB && rows.length && !jobR) jobR = c.adId;
}
await qa.note(`deck cards naming a denial: ${naming.join(' || ') || '(none)'}`);
const cardB = ((await call('/api/onboarding/cards')).json?.cards ?? []).find((c) => c.adId === jobB);
await assert((cardB?.askedClosed ?? []).length === 0, 'deck: job B card still names nothing');
await assert(Boolean(jobR), 'the risk "No" is named on at least one other posting that asks about risks');
if (jobR) {
  await want(jobR);
  const sR = await tailor();
  await qa.note(`job R doors: ${JSON.stringify(sR.doors)}`);
  await qa.goto('/tailor', `Tailor step for job R (${jobR})`);
  await page.waitForTimeout(900);
  const rowR = page.locator('.tailor .row.settled').first();
  await qa.expectVisible(rowR, 'job R: the risk "No" is named here (the posting genuinely asks)');
  await qa.click(rowR.getByRole('button', { name: DOOR }), `job R: open "${DOOR}"`);
  await qa.expectText('#tailor-ask-q', `You said no to: "${RISK}.`, 'job R (word-matched): door quotes HIS words');
  const q = await page.locator('#tailor-ask-q').textContent();
  await assert(!q.includes("You told me you don't have this"), `job R door never claims he denied the shown requirement: "${q}"`);
  await qa.click(page.getByRole('button', { name: 'No change' }), 'No change');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
