// #425 — the owner's 2026-10-24 staging re-proof, replayed end to end on the fake-model QA stack, at
// phone width, human-paced. Left by the QA gate.
//
// He is an IT project manager going for Hong Kong. His CV lists English (Fluent), a native language,
// and one more at a level short of working (B1) — and no Cantonese, no Mandarin. What he must see:
//   1  the reveal leaves out the job that REQUIRES Cantonese and the one that REQUIRES Mandarin, and
//      says so, one line per language, each with its count and a "Yes, I speak <it>" button;
//   2  the job where Cantonese is only "an advantage" stays in his deck;
//   3  "Yes, I speak Cantonese" brings the Cantonese job back (the count grows, the line goes);
//      Mandarin's line stays, because he did not tap it;
//   4  a job he pastes that requires fluent English and German: the card counts English met in his
//      CV's own words, and the Tailor step asks about German (B1 settles nothing), never English;
//   5  (only when MAIL_LOG names a file a mail-recording wrapper writes) the application report that
//      travels with the approved CV agrees with the card: English is not "Not checked".
//
// Uses qa-main.ts's canned language adverts (armed for this run, put back at the end). The CV is the
// fake miner's (Polish native, English C1, German B1); his English line is rewritten to "English
// (Fluent)" through the edit door, the way cv-language-level-journey.mjs does — only that one, since
// the fake writer's canned draft prints these three languages and the draft lint holds it to them.
// One sign-in.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 [MAIL_LOG=<file>] node apps/web/e2e/owner-language-filter-journey.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const MAIL_LOG = process.env.MAIL_LOG ?? null;
const ROLE = 'IT project manager in Hong Kong';
const EMAIL = `owner-language-${Date.now()}@example.com`;
const MANDARIN_BLOCKING_AD = liveAdId('2026-07-05_okx_senior-strategy-project-manager-vip-institutions');
const CANTONESE_PLUS_AD = liveAdId('2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting');
const CANTONESE_BLOCKING_AD = liveAdId('2026-07-13_bnp-paribas_senior-project-manager');
const ADVERT = `Regional IT Project Manager — Nordwerk Systems
Munich, Germany · Hybrid

What we are looking for
- Own the delivery of a multi-country ERP rollout across three vendor teams.
- Required language: English — Fluent written and spoken English for the regional steering committee.
- Required language: German — Fluent German for the Munich operations team.`;
const ENGLISH_REQ = 'pasted-2';
const ENGLISH_LINE = 'Fluent written and spoken English for the regional steering committee.';

const qa = await createSession('owner-language-filter-journey', { baseURL: BASE, viewport: { width: 390, height: 844 } });
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
const deckIds = async () => ((await api('/api/onboarding/cards')).json?.cards ?? []).map((c) => c.adId);
const revealCount = async () => Number(((await page.locator('.curtain h1').first().textContent()) ?? '').match(/\d+/)?.[0] ?? NaN);

try {
  // 1. The front door, the role, his CV read and checked, signed in.
  await qa.goto('/', 'the front door');
  const armed = (await api('/api/qa/stack', 'POST', { languageAdverts: true })).status;
  await assert(armed === 200, `the QA stack serves its three language adverts for this run (HTTP ${armed})`);
  await qa.goto('/discovery', 'into discovery');
  await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'he types the role he is going for');
  await qa.click(page.getByRole('button', { name: "That's me" }), "That's me");
  await page.waitForURL(/\/(deck|profile\/check)/, { timeout: 30_000 });
  const facts = await qa.factsFromCv();
  await qa.note(`his CV was read and checked (${facts} facts)`);
  const link = await api('/api/auth/request-link', 'POST', { email: EMAIL });
  await assert(!!link.json?.devLink, `sign-in link issued (HTTP ${link.status})`);
  await api('/api/auth/verify', 'POST', { token: new URL('http://x' + link.json.devLink).searchParams.get('token') });

  // His English line, in his own words.
  const lines = ((await api('/api/profile')).json?.domains ?? []).filter((d) => d.tag === 'lang').flatMap((d) => d.facts);
  await qa.note(`the CV's language lines as read: ${JSON.stringify(lines.map((f) => f.text))}`);
  const english = lines.find((f) => /English/.test(f.text));
  await assert(!!english && lines.some((f) => /German/.test(f.text) && /B1/.test(f.text)), 'his CV lists English, and German at B1');
  const edited = await api(`/api/onboarding/claims/${encodeURIComponent(english.id)}`, 'PUT', { text: 'English (Fluent)' });
  await assert(edited.status === 200, `he writes his English line as "English (Fluent)" (HTTP ${edited.status})`);
  const now = ((await api('/api/profile')).json?.domains ?? []).filter((d) => d.tag === 'lang').flatMap((d) => d.facts).map((f) => f.text);
  await qa.note(`his CV's language lines now: ${JSON.stringify(now)}`);
  await assert(now.includes('English (Fluent)') && !now.some((t) => /Cantonese|Mandarin|Chinese/.test(t)),
    'his CV says English (Fluent), and nothing about Cantonese or Mandarin');

  // 2. The reveal names what it left out.
  await qa.goto('/deck', 'open his deck — the reveal');
  await qa.expectVisible(page.getByRole('button', { name: 'See them' }), 'the reveal, before the deck');
  await qa.scrollThrough('read the reveal top to bottom, as he would');
  const cantonese = page.locator('.curtain .aside', { hasText: 'Cantonese' });
  const mandarin = page.locator('.curtain .aside', { hasText: 'Mandarin' });
  await qa.expectText(cantonese, "I left out 1 job that needs Cantonese, which isn't on your profile. Do you speak it?",
    '#425 AC5: a line names Cantonese, how many jobs it took out, and asks');
  await qa.expectText(mandarin, "I left out 1 job that needs Mandarin, which isn't on your profile. Do you speak it?",
    '#425 AC5: Mandarin has its own line');
  await qa.expectVisible(cantonese.getByRole('button', { name: 'Yes, I speak Cantonese' }), 'the one-tap way back, beside the line');
  const ids = await deckIds();
  await assert(!ids.includes(CANTONESE_BLOCKING_AD) && !ids.includes(MANDARIN_BLOCKING_AD),
    '#425 AC1: neither job that REQUIRES a language his CV lacks is in his deck');
  await assert(ids.includes(CANTONESE_PLUS_AD), 'owner decision 1: the job where Cantonese is only "an advantage" stays');

  // 3. "Yes, I speak Cantonese" brings that job back.
  const before = await revealCount();
  await qa.click(cantonese.getByRole('button', { name: 'Yes, I speak Cantonese' }), "he does speak Cantonese — 'Yes, I speak Cantonese'");
  await page.waitForFunction((n) => Number(document.querySelector('.curtain h1')?.textContent?.match(/\d+/)?.[0]) === n + 1, before, { timeout: 10_000 })
    .catch(() => {});
  await assert((await revealCount()) === before + 1, `the count grows by the job it brought back (${before} -> ${await revealCount()})`);
  await assert((await cantonese.count()) === 0, 'the Cantonese line is gone');
  await qa.expectVisible(mandarin, "Mandarin's line stays — he did not say he speaks it");
  await assert((await deckIds()).includes(CANTONESE_BLOCKING_AD), '#425 AC5: the Cantonese job is back in his deck');
  await qa.scrollThrough('read the reveal again');

  // 4. A job he pastes that requires fluent English and German.
  await qa.goto('/paste', 'the paste door');
  await qa.fill(page.locator('#advert'), ADVERT, 'he pastes a job that requires English and German');
  await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
  await page.waitForURL(/\/job\//, { timeout: 180_000 }).catch(() => {});
  await page.locator('.jobcard .row').first().waitFor({ timeout: 60_000 }).catch(() => {});
  await qa.scrollThrough("read the pasted job's card");
  await qa.expectText(page.locator(`.jobcard .row.fit[data-req="${ENGLISH_REQ}"]`), 'Your CV says: English (Fluent)',
    '#425 AC6: the card counts English met, in his CV\'s own words');
  await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await qa.expectText('.tailor .ask .q', 'German', '#425 AC6: German at B1 settles nothing — the Tailor step asks about German');
  const queue = (await api('/api/onboarding/tailor')).json?.questions ?? [];
  await assert(!queue.some((q) => /English/.test(q.question)), '#425 AC6: and nothing about English, anywhere in the queue');
  await qa.click(page.locator('.tailor .opts .opt').first(), 'he answers the German question');
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await qa.expectVisible('.draft-frame', 'the tailored CV draft is shown');
  await qa.scrollThrough('read down through the draft to the send block');

  // 5. Approve, and read the application report that travels with the CV.
  await qa.click(page.getByRole('button', { name: 'Approve and email me this CV' }), 'Approve and email me this CV');
  await page.getByText('Done — your CV is made and the email is on its way.').waitFor({ timeout: 90_000 }).catch(() => {});
  await qa.expectText('.draft-send', 'Done — your CV is made and the email is on its way.', 'Done — the CV is made and the email is on its way');
  if (!MAIL_LOG || !existsSync(MAIL_LOG)) {
    await qa.note('MAIL_LOG not set — the application report is not readable on this stack; step 5 skipped');
  } else {
    const mail = readFileSync(MAIL_LOG, 'utf8').split('=====MAIL to ').slice(1)
      .filter((m) => m.startsWith(`${EMAIL} |`)).map((m) => m.split('\n').slice(1).join('\n').split('=====END')[0]).pop() ?? '';
    await qa.note(`the application report:\n${mail}`);
    await assert(mail.length > 0, 'the application report reached his address');
    const englishRow = mail.split('\n').find((l) => l.includes(ENGLISH_LINE)) ?? '(no English row)';
    await assert(!/Not checked/.test(englishRow),
      `#425 AC6 / owner decision 2: the report agrees with the card — English is not "Not checked" (got: ${englishRow})`);
  }
} finally {
  await api('/api/qa/stack', 'POST', { languageAdverts: false }).catch(() => {});
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
