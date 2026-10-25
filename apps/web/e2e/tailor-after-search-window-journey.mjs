// #431 — a job the deck found stays tailorable long after the deck's search. Human-paced, over a
// REAL stack (qa-main's fake model; no ANTHROPIC_API_KEY, no paid call).
//
// The defect: the deck's "search again?" window (5 minutes, postingRetrieval.ts's SNAPSHOT_REUSE_MS)
// was also read as "may this job still be tailored?". Nothing on the Tailor screen searches again,
// so every Tailor door answered 404 "unknown card" five minutes after the search — the owner's
// staging run, 2026-10-25: the draft written, then five Approve presses all refused.
//
// This journey does what he did, with the clock running for real: pick a job from the deck, let the
// draft and its suggestions arrive, then sit reading the CV until well past six minutes after the
// deck's search. Only then does he act — reload the screen, Edit wording, It's true and its Undo, Use,
// No, Approve — and every Tailor call from that point must answer, none with 404. Last, the deck
// itself is opened: past its window it searches again (AC2 — the deck's freshness is unchanged),
// and the job he is tailoring is still his afterwards.
//
// Takes about 9 minutes, most of it the wait. QA_WAIT_MS overrides the wait (default: until
// 6 min 20 s after the deck's search) — shortening it below 5 min makes the run prove nothing.
//
//   PORT=34431 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34431 npx next build && npx next start -p 34430
//   BASE_URL=http://127.0.0.1:34430 node apps/web/e2e/tailor-after-search-window-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `late-tailor-${Date.now()}@example.com`;
const PAST_WINDOW_MS = 6 * 60 * 1000 + 20 * 1000;
const DECK_WINDOW_MS = 5 * 60 * 1000;

const USE = 'Use for this job';
const TRUE = "It's true: keep it on my CV for every job";
const APPROVE = 'Approve and email me this CV';
const DONE = 'Done — your CV is made and the email is on its way.';

const qa = await createSession('tailor-after-search-window-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
page.setDefaultTimeout(20_000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
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
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const src = () => page.locator('.draft-frame').getAttribute('srcdoc');
const mins = (ms) => `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

// ---------------------------------------------------------------------------------------------
// 0. His session, set up the way stretch-use-journey.mjs does: role, a reviewed CV, a real sign-in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — the anonymous session');
await page.waitForTimeout(700);
await call('POST', '/api/onboarding/discovery/start', { role: ROLE });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`the CV gave the session no facts (${facts})`);
await qa.note(`his CV was read and reviewed — ${facts} facts`);
const link = await call('POST', '/api/auth/request-link', { email: EMAIL });
if (!link.json?.devLink) throw new Error(`sign-in failed (${link.status}): ${link.text}`);
await call('POST', '/api/auth/verify', { token: new URL('http://x' + link.json.devLink).searchParams.get('token') });

// ---------------------------------------------------------------------------------------------
// 1. The deck searches; he picks a job.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal — the deck searches for his jobs');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the first card renders with its score');
const deck = await api('/api/onboarding/cards');
const searchedAt = Date.parse(deck?.retrieval?.retrievedAt ?? '') || Date.now();
await qa.note(`the deck's search: ${new Date(searchedAt).toISOString()} (${deck?.retrieval?.outcome}, ${deck?.cards?.length} cards)`);
const deckTitle = (await page.locator('.jobcard h2').first().textContent()).trim();
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), `I want this one ("${deckTitle}")`);
await page.waitForURL('**/tailor', { timeout: 15_000 });

// ---------------------------------------------------------------------------------------------
// 2. The draft and its suggestions arrive, as they do today.
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question this job left open — answered once');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is written');
const card1 = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await card1.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible(card1, 'the first suggestion opens beside it');
const tailorAdId = (await api('/api/onboarding/tailor'))?.card?.adId;
await qa.note(`tailoring ${tailorAdId}`);

// ---------------------------------------------------------------------------------------------
// 3. He reads. The clock runs for real past the deck's window — no button is pressed meanwhile.
// ---------------------------------------------------------------------------------------------
const waitMs = Number(process.env.QA_WAIT_MS ?? Math.max(0, searchedAt + PAST_WINDOW_MS - Date.now()));
await qa.note(`reading the CV for ${mins(waitMs)} — until ${mins(Date.now() + waitMs - searchedAt)} after the deck's search`);
const box = await page.locator('.draft-frame').boundingBox();
const readUntil = Date.now() + waitMs;
let dir = 1;
while (Date.now() < readUntil) {
  // A person reading: scroll the CV a little every half minute, down then back up.
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(300, box.height / 2));
  await page.mouse.wheel(0, 240 * dir);
  dir = -dir;
  await page.waitForTimeout(Math.min(30_000, Math.max(0, readUntil - Date.now())));
}
const lateBy = Date.now() - searchedAt;
await assert(lateBy > DECK_WINDOW_MS + 60_000, `now ${mins(lateBy)} after the deck's search — past its 5-minute window`);

// Every Tailor call from here on is recorded; none may answer "unknown card".
const tailorCalls = [];
page.on('response', (res) => {
  const u = new URL(res.url());
  if (u.pathname.startsWith('/api/onboarding/tailor')) tailorCalls.push(`${res.request().method()} ${u.pathname} → ${res.status()}`);
});

// ---------------------------------------------------------------------------------------------
// 4. He comes back to it: reload the screen.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload the Tailor screen, past the window');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the draft is still there — no "unknown card"');
await assert(!/unknown card|Couldn't open this job/i.test(await page.locator('body').innerText()), 'no refusal on the screen');
await qa.expectVisible(page.getByRole('heading', { name: deckTitle }), `the job still heads the screen ("${deckTitle}")`);
await card1.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.expectVisible(card1, 'suggestion 1 is open again');
const view = await api('/api/onboarding/tailor/draft');
const [s1, s2] = view?.stretch?.suggestions ?? [];
await assert(!!s1, `the draft view answers with its suggestions (${view?.stretch?.suggestions?.length ?? 0})`);
const redraft = await call('POST', '/api/onboarding/tailor/draft');
await assert(redraft.status !== 404, `POST draft answers ${redraft.status}, not 404`);

// ---------------------------------------------------------------------------------------------
// 5. Edit wording, It's true and its Undo, Use — on suggestion 1.
// ---------------------------------------------------------------------------------------------
const EDITED = `${s1.claimText}, across three vendor teams`;
await qa.press(card1.getByRole('heading'), 'e', 'E — edit the wording');
const ins = page.frameLocator('.draft-frame').locator('ins');
await qa.fill(ins, EDITED, 'type the new wording');
await qa.press(ins, 'Escape', 'Esc ends the edit');
const SAID = `If they ask, I explain the work behind it: ${EDITED}`;
await card1.getByText(SAID).waitFor({ timeout: 15_000 }).catch(() => {});
await qa.expectText(card1, SAID, 'the edit is saved: what to say is rewritten for it');

// Pressed directly, not through qa.click: the card closes on the answer, and the driver's scroll back
// to a button that is gone outlasts the 5-second toast this step must see.
const trueBtn = card1.getByRole('button', { name: new RegExp(`^${TRUE}`) });
await qa.expectVisible(trueBtn, `"It's true" on suggestion 1`);
await trueBtn.click();
const toast = page.locator('.tailor .toast');
await toast.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
await qa.expectVisible(toast, "It's true is accepted — the toast confirms it");
await toast.getByRole('button', { name: 'Undo' }).click({ timeout: 3000 });
await page.waitForTimeout(1200);
await card1.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
await qa.expectVisible(card1, 'Undo took: suggestion 1 is open again');

const before = await api('/api/onboarding/tailor');
await qa.click(card1.getByRole('button', { name: new RegExp(`^${USE}`) }), 'Use for this job');
await page.waitForTimeout(2000);
const after = await api('/api/onboarding/tailor');
await assert(after?.requirements?.find((r) => r.id === s1.requirementId)?.state === 'stretched', 'Use took: the requirement reads "stretched"');
await qa.note(`score ${before?.card?.matchPct}% → ${after?.card?.matchPct}%`);
await assert((await src()).includes(`<li>${esc(EDITED)}</li>`), 'the CV carries the edited line');

// ---------------------------------------------------------------------------------------------
// 6. No — on suggestion 2 (when the step found one).
// ---------------------------------------------------------------------------------------------
const card2 = page.getByRole('region', { name: /^Suggestion 2 of \d+$/ });
if (s2 && (await card2.count()) > 0) {
  await qa.press(card2.getByRole('heading'), 'n', 'N — No, for suggestion 2');
  await page.waitForTimeout(1500);
  const answered = (await api('/api/onboarding/tailor/draft'))?.stretch?.suggestions?.find((x) => x.id === s2.id);
  await qa.note(`suggestion 2 after No: ${JSON.stringify(answered?.answer ?? answered?.state ?? null)}`);
} else {
  await qa.note(`no second suggestion open (${s2 ? 'not on screen' : 'the step found one'}) — No was not pressed`);
}

// ---------------------------------------------------------------------------------------------
// 7. Approve — the press the owner made five times.
// ---------------------------------------------------------------------------------------------
await page.keyboard.press('Escape');
await qa.click(page.getByRole('button', { name: APPROVE }), 'Approve and email me this CV');
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, `Done — approved ${mins(Date.now() - searchedAt)} after the deck's search`);

await qa.note(`Tailor calls since the window passed: ${tailorCalls.join(' · ')}`);
const refused = tailorCalls.filter((c) => c.endsWith('404'));
await assert(tailorCalls.length > 0 && refused.length === 0, `no Tailor call answered 404 (${tailorCalls.length} calls, ${refused.length} refused)`);

// ---------------------------------------------------------------------------------------------
// 8. AC2: the deck's own window is unchanged — opened now, it searches again. And the job he is
//    tailoring is still his afterwards.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'back to the deck, past its window');
let again = await api('/api/onboarding/cards');
for (let i = 0; i < 60 && again?.searching === true; i += 1) {
  await page.waitForTimeout(500);
  again = await api('/api/onboarding/cards');
}
const researchedAt = Date.parse(again?.retrieval?.retrievedAt ?? '');
await qa.note(`the deck's search now: ${again?.retrieval?.retrievedAt} (${again?.retrieval?.outcome}, ${again?.cards?.length} cards)`);
await assert(Number.isFinite(researchedAt) && researchedAt > searchedAt + DECK_WINDOW_MS, 'the deck searched again — its 5-minute rule still governs it');
await qa.scrollThrough('the deck after its new search');
const still = await call('GET', '/api/onboarding/tailor');
await assert(still.status === 200 && still.json?.card?.adId === tailorAdId, `the job he is tailoring is still his (${still.status})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
