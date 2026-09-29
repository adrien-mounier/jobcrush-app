// #308 QA gate — "a skip is not an answer", driven adversarially on the rendered screen.
//
// What the two existing journeys (asked-once, language-ladder) do NOT pin, and this one does:
//   1. The deck — the rendered card AND its payload — asks no language question at all.
//   2. The queue never carries a Yes/No twin of the graded language question (whole payload read,
//      not just questions[0]), and the Yes/No door refuses that requirement outright.
//   3. "Not now" leaves NO trace in her profile — the server's own profile payload, before and after.
//   4. A second skip of the same question on the same job is refused (it is not asked there any more).
//   5. Per-advert memory survives a DETOUR: skip on job A, tailor job B, come back to A — A still
//      does not re-ask, while a third job needing the same language asks again.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/not-sure-yet-detour-journey.mjs
//
// Uses qa-main.ts's canned language adverts (armed for this run, put back at the end), the same
// knob language-ladder-journey.mjs uses. The visitor's side is never seeded beyond the floor.
import { createSession } from './qa-driver.mjs';
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const ROLE = 'IT project manager in Hong Kong';
const MANDARIN_BLOCKING_AD = liveAdId('2026-07-05_okx_senior-strategy-project-manager-vip-institutions');
const CANTONESE_PLUS_AD = liveAdId('2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting');
const CANTONESE_BLOCKING_AD = liveAdId('2026-07-13_bnp-paribas_senior-project-manager');

const qa = await createSession('not-sure-yet-detour-journey', { baseURL: BASE, viewport: { width: 390, height: 844 } });
const { page } = qa;
page.setDefaultTimeout(12000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

const api = (url, method = 'GET', body) => page.evaluate(async ({ url, method, body }) => {
  const r = await fetch(url, {
    method, credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}, { url, method, body });

const setLanguageAdverts = (on) => api('/api/qa/stack', 'POST', { languageAdverts: on }).then((r) => r.status);
const langFacts = async () => {
  const r = await api('/api/profile');
  return {
    status: r.status,
    langDomain: (r.json?.domains ?? []).filter((d) => d.tag === 'lang').flatMap((d) => d.facts.map((f) => f.text)),
    factCount: r.json?.factCount ?? null,
  };
};
const readAsk = () => page.evaluate(() => {
  const root = document.querySelector('.tailor .ask');
  if (!root) return null;
  return {
    q: root.querySelector('.q')?.textContent?.trim() ?? null,
    rungs: [...root.querySelectorAll('.opts .opt')].map((b) => b.textContent.trim()),
    skip: root.querySelector('.skip')?.textContent?.trim() ?? null,
  };
});
const tailorQuestions = async () => (await api('/api/onboarding/tailor')).json?.questions ?? [];

// 0. Arm the canned language adverts.
await qa.goto('/', 'the front door');
const armed = await setLanguageAdverts(true);
await assert(armed === 200, `the QA stack armed the language adverts (HTTP ${armed})`);

try {
  // 1. Earn a signed-in session — floor answered, NO language declared.
  await qa.goto('/discovery', 'land on discovery');
  await page.waitForTimeout(700);
  await api('/api/onboarding/discovery/start', 'POST', { role: ROLE });
  const seeded = await qa.seedFloorAnswers();
  await qa.note(`floor seeded: ${seeded.join(', ')} — languages deliberately left undeclared`);
  const link = await api('/api/auth/request-link', 'POST', { email: `not-sure-detour-${Date.now()}@example.com` });
  await assert(!!link.json?.devLink, `sign-in link issued (HTTP ${link.status})`);
  const token = new URL('http://x' + link.json.devLink).searchParams.get('token');
  await api('/api/auth/verify', 'POST', { token });

  const cards = await qa.cardsWhenRetrieved();
  const ids = (cards?.cards ?? []).map((c) => c.adId);
  await assert([MANDARIN_BLOCKING_AD, CANTONESE_PLUS_AD, CANTONESE_BLOCKING_AD].every((id) => ids.includes(id)),
    'all three language adverts are in her deck');
  await assert((cards?.cards ?? []).every((c) => !('levelAsk' in c)),
    'AC3: no card in the deck payload carries a language question');

  // 2. The rendered deck asks nothing.
  await qa.goto('/deck', 'open the deck');
  const seeThem = page.getByRole('button', { name: /See them/i });
  if (await seeThem.count()) await qa.click(seeThem, 'past the reveal — "See them"');
  await page.waitForTimeout(1200);
  await qa.scrollThrough('read the first card top to bottom');
  await assert((await page.locator('fieldset.ladder, .jcbody .rung, .jcbody .skip').count()) === 0,
    'AC3: the deck card renders no ladder, no rungs, no skip — the card no longer asks');

  const before = await langFacts();
  await qa.note(`profile language facts before any answer: ${JSON.stringify(before)}`);

  // 3. Job A (Cantonese an advantage): graded question, no Yes/No twin anywhere in the queue.
  await assert((await api(`/api/onboarding/cards/${encodeURIComponent(CANTONESE_PLUS_AD)}/want`, 'POST')).status === 200,
    'job A (Cantonese an advantage) becomes the tailor target');
  await qa.goto('/tailor', 'the Tailor step for job A');
  await qa.expectVisible('.jobdeck.tailor', 'the tailor screen mounted');
  await page.waitForTimeout(900);
  const askA = await readAsk();
  await qa.note(`job A's first question: ${JSON.stringify(askA)}`);
  await assert(/Cantonese/.test(askA?.q ?? '') && askA.rungs.length === 6 && askA.skip === 'Not now',
    'AC3/AC4: the graded Cantonese question leads the queue — six rungs and "Not now"');
  await assert(!askA.rungs.some((r) => /^(yes|no)\b/i.test(r)), 'AC4: no Yes/No among the answers');
  const qsA = await tailorQuestions();
  const ladderId = qsA.find((q) => q.kind === 'profile' && /Cantonese/.test(q.question))?.requirementId;
  const twins = qsA.filter((q) => q.kind !== 'profile' && /cantonese|mandarin|language/i.test(q.question));
  await qa.note(`job A's whole queue: ${JSON.stringify(qsA.map((q) => [q.kind ?? 'advert', q.question.slice(0, 70), q.options.length]))}`);
  await assert(twins.length === 0, `AC4: nowhere in the queue is a language asked as Yes/No — ${JSON.stringify(twins)}`);
  const twinDoor = await api('/api/onboarding/tailor/answer', 'POST', { requirementId: ladderId, answer: 'Yes' });
  await assert(twinDoor.status === 404, `AC4: the Yes/No door refuses the language requirement (HTTP ${twinDoor.status})`);

  // 4. "Not now". Nothing lands in her profile; a second skip is refused.
  await qa.scrollThrough('read the graded question before answering');
  await qa.click(page.locator('.tailor .ask .skip'), 'she is not sure — "Not now"');
  await page.waitForTimeout(1500);
  await qa.expectText('.tailor .ledger', 'Nothing saved', 'AC1: the screen says nothing was saved');
  const afterSkip = await langFacts();
  await qa.note(`profile language facts after "Not now": ${JSON.stringify(afterSkip)}`);
  await assert(JSON.stringify(afterSkip.langDomain) === JSON.stringify(before.langDomain) && afterSkip.factCount === before.factCount,
    'AC5: the skip left her profile exactly as it was — no language, no level, no count change');
  const reskip = await api('/api/onboarding/tailor/profile-answer', 'POST', { requirementId: ladderId, answer: 'Not now' });
  await assert(reskip.status === 404, `a second skip on the same job is refused — it is not asked here any more (HTTP ${reskip.status})`);

  // 5. Detour: job B (Mandarin). A different language, so it asks — about Mandarin.
  await assert((await api(`/api/onboarding/cards/${encodeURIComponent(MANDARIN_BLOCKING_AD)}/want`, 'POST')).status === 200,
    'detour: job B (Mandarin needed) becomes the target');
  await qa.goto('/tailor', 'the Tailor step for job B');
  await page.waitForTimeout(900);
  const askB = await readAsk();
  await assert(/Mandarin/.test(askB?.q ?? ''), `job B asks about Mandarin, its own language ("${askB?.q}")`);

  // 6. Back to job A: still never re-asked (per-advert, survives the detour).
  await assert((await api(`/api/onboarding/cards/${encodeURIComponent(CANTONESE_PLUS_AD)}/want`, 'POST')).status === 200,
    'back to job A');
  await qa.goto('/tailor', 'the Tailor step for job A again, after the detour');
  await page.waitForTimeout(900);
  const askA2 = await readAsk();
  await qa.note(`job A after the detour: ${JSON.stringify(askA2)}`);
  await assert(!/Cantonese/.test(askA2?.q ?? ''), 'ADR-0011 clause 4: never twice for the same job — even after a detour');
  await assert(!(await tailorQuestions()).some((q) => /Cantonese/.test(q.question)), 'and Cantonese is nowhere in job A\'s queue');

  // 7. Job C (Cantonese needed): the skipped question comes back.
  await assert((await api(`/api/onboarding/cards/${encodeURIComponent(CANTONESE_BLOCKING_AD)}/want`, 'POST')).status === 200,
    'job C (Cantonese needed) becomes the target');
  await qa.goto('/tailor', 'the Tailor step for job C');
  await page.waitForTimeout(900);
  const askC = await readAsk();
  await assert(/Cantonese/.test(askC?.q ?? '') && askC.rungs.length === 6,
    `AC2: not now meant not now — the next job needing Cantonese asks again, graded ("${askC?.q}")`);
  await qa.scrollThrough('the returned question, read top to bottom');
  const end = await langFacts();
  await assert(JSON.stringify(end.langDomain) === JSON.stringify(before.langDomain),
    `AC5: still nothing stored about her languages — ${JSON.stringify(end)}`);
} finally {
  const disarmed = await setLanguageAdverts(false);
  await assert(disarmed === 200, `the language adverts are disarmed again (HTTP ${disarmed})`);
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
