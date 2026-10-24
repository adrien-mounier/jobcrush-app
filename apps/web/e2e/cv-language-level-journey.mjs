// #425 AC6 — "What the CV's level word settles", proved on the rendered screens.
//
// With "English (Fluent)" on her CV, a job that requires fluent English shows that requirement as
// met on its card and opens the Tailor step with no English question. With "German" at B1 — a level
// word that does not say she works in it — the same job keeps the German requirement open and the
// Tailor step asks about German. The fake judge rates every requirement after an advert's first one
// as only partly met (qa-main.ts), so an English row under "Where you fit" can only come from the
// record rule (recordBars.ts), never from the scorer.
//
// The job is PASTED: the QA entry reads a pasted advert's "- " lines as its requirements, and a
// "- Required language: <name> — <line>" bullet as a blocking language requirement (#425). A job she
// brought is never withdrawn (#305), so this journey is about the level word alone.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/cv-language-level-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const ADVERT = `Regional IT Project Manager — Nordwerk Systems
Munich, Germany · Hybrid

What we are looking for
- Own the delivery of a multi-country ERP rollout across three vendor teams.
- Required language: English — Fluent written and spoken English for the regional steering committee.
- Required language: German — Fluent German for the Munich operations team.`;
// The three requirements, as the QA reader ids them (pasted-<n>, in advert order).
const ENGLISH = 'pasted-2';
const GERMAN = 'pasted-3';

const qa = await createSession('cv-language-level-journey', { baseURL: BASE, viewport: { width: 390, height: 844 } });
const { page } = qa;
page.setDefaultTimeout(15000);
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

// 1. Her CV, read and checked. The fake miner reads "English proficiency at C1 level." — a code, not
//    a working word — so she says it in her own words, the way the profile's edit door lets her.
await qa.goto('/', 'the front door');
const session = await api('/api/sessions/anonymous', 'POST'); // what the front door does on her first action
await assert(session.status === 200 || session.status === 201, `a session is started (HTTP ${session.status})`);
const facts = await qa.factsFromCv();
await qa.note(`her CV was read and checked (${facts} facts)`);
const profile = (await api('/api/profile')).json;
const lines = (profile?.domains ?? []).filter((d) => d.tag === 'lang').flatMap((d) => d.facts);
await qa.note(`her CV's language lines: ${JSON.stringify(lines.map((f) => [f.id, f.text]))}`);
const english = lines.find((f) => /English/.test(f.text));
const german = lines.find((f) => /German/.test(f.text));
await assert(!!english && !!german, 'her CV lists English and German');

// 2. Signed in (the edit door and the paste door both need it), she rewrites her English line and
//    pastes a job that requires both languages.
const link = await api('/api/auth/request-link', 'POST', { email: `cv-language-level-${Date.now()}@example.com` });
await assert(!!link.json?.devLink, `sign-in link issued (HTTP ${link.status})`);
const token = new URL('http://x' + link.json.devLink).searchParams.get('token');
await api('/api/auth/verify', 'POST', { token });
const edited = await api(`/api/onboarding/claims/${encodeURIComponent(english.id)}`, 'PUT', { text: 'English (Fluent)' });
await assert(edited.status === 200, `she writes her English line as "English (Fluent)" (HTTP ${edited.status})`);
await qa.note(`her German line stays as the CV says it: ${JSON.stringify(german.text)}`);
const started = await api('/api/onboarding/paste', 'POST', { text: ADVERT });
await assert(started.status === 202, `the job is pasted (HTTP ${started.status})`);
let adId = null;
for (let i = 0; i < 300 && !adId; i += 1) {
  const job = (await api(`/api/jobs/${started.json.jobId}`)).json;
  if (job?.status === 'failed') break;
  adId = job?.progress?.paste?.result?.adId ?? null;
  if (!adId) await page.waitForTimeout(400);
}
await assert(!!adId, `the pasted job was read (${adId})`);

// 3. Its card: English met by the CV's word, German still open.
await qa.goto(`/job/${encodeURIComponent(adId)}`, "the job's own screen");
await page.locator('.jobcard .row').first().waitFor({ timeout: 60_000 });
await qa.scrollThrough('read the card, top to bottom');
await qa.expectVisible(page.locator(`.jobcard .row.fit[data-req="${ENGLISH}"]`),
  '#425 AC6: "English (Fluent)" on her CV — the English requirement is under "Where you fit"');
await qa.expectText(page.locator(`.jobcard .row.fit[data-req="${ENGLISH}"]`), 'Your CV says: English (Fluent)',
  'and the row says why in her CV\'s own words — not the scorer\'s "only part of this shows"');
await qa.expectVisible(page.locator(`.jobcard .row.open[data-req="${GERMAN}"]`),
  'German at B1 settles nothing — the German requirement is still open');
await assert((await page.locator(`.jobcard .row.open[data-req="${ENGLISH}"]`).count()) === 0, 'and English is not listed as open');

// 4. The Tailor step asks about German, never English.
const wanted = await api(`/api/onboarding/cards/${encodeURIComponent(adId)}/want`, 'POST');
await assert(wanted.status === 200, `she wants the job (HTTP ${wanted.status})`);
await qa.goto('/tailor', 'the Tailor step for this job');
await qa.expectVisible('.jobdeck.tailor', 'the Tailor step mounted');
await qa.expectText('.tailor .ask .q', 'German', '#425 AC6: the language question asks about German');
const questions = (await api('/api/onboarding/tailor')).json?.questions ?? [];
await qa.note(`the whole queue: ${JSON.stringify(questions.map((q) => q.question))}`);
await assert(questions.some((q) => /German/.test(q.question)), 'the queue holds the German question');
await assert(!questions.some((q) => /English/.test(q.question)), '#425 AC6: and nothing about English, anywhere in the queue');
await qa.scrollThrough('read the question as she sees it');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
