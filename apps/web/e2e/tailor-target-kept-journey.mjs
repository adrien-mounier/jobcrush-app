// #434 — the job being tailored stays his when a later deck search fails or leaves it out.
// Human-paced, over a REAL stack (qa-main's fake model and stand-in job source; no ANTHROPIC_API_KEY,
// no paid call).
//
// The defect: since #431 the Tailor step read its job from the session's LAST search. A deck search
// made later (he goes back to the deck more than 5 minutes after it searched) replaced that search —
// and when the source was down, or the new search no longer had this job, every Tailor door answered
// 404 "unknown card" although the job itself was still live.
//
// This journey: pick a job, let the draft arrive, read until the deck's 5-minute window has passed.
// Then (1) the job source goes down and he opens the deck — it searches again and fails; back on the
// Tailor screen the job and its draft are still there. (2) 31 s later (the failed search's own retry
// window) the source answers with no jobs and he opens the deck again — the new search leaves his
// job out; back on the Tailor screen he presses Approve and it goes through. No Tailor call may
// answer 404. The source is put back to normal at the end, whatever happens.
//
// Takes about 8 minutes, most of it the wait. QA_WAIT_MS overrides the wait (default: until 5 min
// 20 s after the deck's search) — shortening it below 5 min makes the run prove nothing.
//
//   PORT=34434 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34434 npx next build && npx next start -p 34435
//   BASE_URL=http://127.0.0.1:34435 node apps/web/e2e/tailor-target-kept-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `kept-target-${Date.now()}@example.com`;
const PAST_WINDOW_MS = 5 * 60 * 1000 + 20 * 1000;
const DECK_WINDOW_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 30 * 1000;

const APPROVE = 'Approve and email me this CV';
const DONE = 'Done — your CV is made and the email is on its way.';

const qa = await createSession('tailor-target-kept-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
page.setDefaultTimeout(20_000);

const call = (method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const res = await fetch(p, {
      method: m,
      credentials: 'same-origin',
      headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON is itself evidence */ }
    return { status: res.status, json, text: text.slice(0, 300) };
  }, [method, path, body ?? null]);
const api = async (path) => (await call('GET', path)).json;
const setSource = (outcome) => call('POST', '/api/qa/stack', { retrievalOutcome: outcome });
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const mins = (ms) => `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

let aborted = false;
async function restoreAndExit(code, why) {
  try { await setSource('relevant_postings'); } catch { /* the page may be gone */ }
  if (why) { try { await qa.note(why); } catch {} }
  const ok = await qa.finish();
  process.exit(code ?? (ok ? 0 : 1));
}
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    await restoreAndExit(1, `RUN ABORTED (${ev}): ${e?.message ?? e}`);
  });
}

/** Open the deck and wait for its search to settle; returns the cards answer. */
async function openDeck(note) {
  await qa.goto('/deck', note);
  let deck = await api('/api/onboarding/cards');
  for (let i = 0; i < 60 && deck?.searching === true; i += 1) {
    await page.waitForTimeout(500);
    deck = await api('/api/onboarding/cards');
  }
  await page.waitForTimeout(1000);
  await qa.scrollThrough(`${note} — what the deck shows`);
  return deck;
}

/** The Tailor screen loads with his job and its draft — no refusal. */
async function tailorStillHis(title, note) {
  await qa.goto('/tailor', note);
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await qa.expectVisible('.draft-frame', `${note}: the draft is still there`);
  await assert(!/unknown card|Couldn't open this job/i.test(await page.locator('body').innerText()), `${note}: no refusal on the screen`);
  await qa.expectVisible(page.getByRole('heading', { name: title }), `${note}: the job still heads the screen ("${title}")`);
}

await qa.goto('/discovery', 'land on discovery — the anonymous session');
const reset = await setSource('relevant_postings');
if (reset.status !== 200) throw new Error(`/api/qa/stack answered ${reset.status} — this journey needs qa-main behind BASE_URL`);

// ---------------------------------------------------------------------------------------------
// 0. His session: role, a reviewed CV, a real sign-in.
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(700);
await call('POST', '/api/onboarding/discovery/start', { role: ROLE });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`the CV gave the session no facts (${facts})`);
await qa.note(`his CV was read and reviewed — ${facts} facts`);
const link = await call('POST', '/api/auth/request-link', { email: EMAIL });
if (!link.json?.devLink) throw new Error(`sign-in failed (${link.status}): ${link.text}`);
await call('POST', '/api/auth/verify', { token: new URL('http://x' + link.json.devLink).searchParams.get('token') });

// ---------------------------------------------------------------------------------------------
// 1. The deck searches; he picks a job; the draft arrives.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal — the deck searches for his jobs');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the first card renders with its score');
const deck = await api('/api/onboarding/cards');
const searchedAt = Date.parse(deck?.retrieval?.retrievedAt ?? '') || Date.now();
await qa.note(`the deck's search: ${new Date(searchedAt).toISOString()} (${deck?.retrieval?.outcome}, ${deck?.cards?.length} cards)`);
const title = (await page.locator('.jobcard h2').first().textContent()).trim();
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), `I want this one ("${title}")`);
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question this job left open — answered once');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is written');
const tailorAdId = (await api('/api/onboarding/tailor'))?.card?.adId;
await qa.note(`tailoring ${tailorAdId}`);

// ---------------------------------------------------------------------------------------------
// 2. He reads until the deck's 5-minute window has passed.
// ---------------------------------------------------------------------------------------------
const waitMs = Number(process.env.QA_WAIT_MS ?? Math.max(0, searchedAt + PAST_WINDOW_MS - Date.now()));
await qa.note(`reading the CV for ${mins(waitMs)} — until ${mins(Date.now() + waitMs - searchedAt)} after the deck's search`);
const box = await page.locator('.draft-frame').boundingBox();
const readUntil = Date.now() + waitMs;
let dir = 1;
while (Date.now() < readUntil) {
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(300, box.height / 2));
  await page.mouse.wheel(0, 240 * dir);
  dir = -dir;
  await page.waitForTimeout(Math.min(30_000, Math.max(0, readUntil - Date.now())));
}
await assert(Date.now() - searchedAt > DECK_WINDOW_MS, `now ${mins(Date.now() - searchedAt)} after the deck's search — past its 5-minute window`);

const tailorCalls = [];
page.on('response', (res) => {
  const u = new URL(res.url());
  if (u.pathname.startsWith('/api/onboarding/tailor')) tailorCalls.push(`${res.request().method()} ${u.pathname} → ${res.status()}`);
});

// ---------------------------------------------------------------------------------------------
// 3. The job source goes down; he opens the deck — it searches again, and the search fails.
// ---------------------------------------------------------------------------------------------
await setSource('provider_unavailable');
const failed = await openDeck('back to the deck while the job source is down');
await qa.note(`the deck's new search: ${JSON.stringify({ outcome: failed?.retrieval?.outcome, cards: failed?.cards?.length })}`);
await assert(failed?.retrieval?.outcome === 'provider_unavailable', 'the deck searched again and the search failed (provider_unavailable)');
const failedAt = Date.now();
await tailorStillHis(title, 'after the failed search');
const t1 = await call('GET', '/api/onboarding/tailor');
await assert(t1.status === 200 && t1.json?.card?.adId === tailorAdId, `the job he is tailoring is still his (${t1.status})`);

// ---------------------------------------------------------------------------------------------
// 4. Past the failed search's own 30 s retry window, the source answers with no jobs at all: the
//    deck's next search leaves his job out.
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(Math.max(0, failedAt + RETRY_WINDOW_MS + 2000 - Date.now()));
await setSource('empty_pool');
const empty = await openDeck('back to the deck — this search no longer has his job');
const ids = (empty?.cards ?? []).map((c) => c.adId ?? c.id);
await qa.note(`the deck's new search: ${JSON.stringify({ outcome: empty?.retrieval?.outcome, cards: ids.length })}`);
await assert(empty?.retrieval?.outcome === 'empty_pool' && !ids.includes(tailorAdId), 'the deck searched again and its result leaves his job out');
await setSource('relevant_postings');

// ---------------------------------------------------------------------------------------------
// 5. Back on the Tailor screen: Approve still goes through.
// ---------------------------------------------------------------------------------------------
await tailorStillHis(title, 'after the search that left the job out');
await page.keyboard.press('Escape');
await qa.click(page.getByRole('button', { name: APPROVE }), 'Approve and email me this CV');
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, 'Done — approved after both later searches');

await qa.note(`Tailor calls after the window passed: ${tailorCalls.join(' · ')}`);
const refused = tailorCalls.filter((c) => c.endsWith('404'));
await assert(tailorCalls.length > 0 && refused.length === 0, `no Tailor call answered 404 (${tailorCalls.length} calls, ${refused.length} refused)`);

await restoreAndExit();
