// #314 "Over two pages: tighten once, then ship and tell" — the live journey, human-paced, over the
// REAL fake-model QA stack with every print measuring 3 pages (QA_PDF_PAGES=3): reach the Tailor
// ending -> ONE press -> the press re-tailors exactly once on a numeric budget, still measures 3,
// ships anyway -> "Done" with the page notice said plainly on the screen. No route mocks.
//
// Then over the wire, with his real cookie: the job record says sent / 3 pages / the notice; the
// stored draft now carries the notice (the screen's next read shows it); the fake model's own call
// counter proves exactly one re-tailor per press.
//
//   PORT=34313 OPS_KEY=qa-ops-key QA_PDF_PAGES=3 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34313 npx next build && npx next start -p 34312
//   BASE_URL=http://127.0.0.1:34312 API_BASE=http://127.0.0.1:34313 node apps/web/e2e/over-two-pages-journey.mjs
//
// On the default stack (no QA_PDF_PAGES, 2 pages) this journey FAILS by design: no tightening, no
// notice — that is the proof it measures something.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:3001';
const ROLE = 'IT project manager in Paris';
const EMAIL = `over-two-${Date.now()}@example.com`;

const S1 = 'Approve and email me this CV';
const S6 = 'Done — your CV is made and the email is on its way.';
const S9 = 'Your CV ran over two pages — shortening it to fit…';
// tailorExport.ts PAGE_NOTICES.stillOver(3, 3) — the stand-in measures 3 after the retry too.
const NOTICE =
  'Your approved draft ran to 3 pages. We shortened it once and it still runs to 3 pages, ' +
  'so it is not word for word the draft you approved. Trim it yourself before you send it.';

const qa = await createSession('over-two-pages-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, i ?? undefined);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init ?? null],
  );
const postJson = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const tailorCalls = async () => (await (await fetch(`${API_BASE}/qa/llm-calls`)).json()).tailor;

async function readThrough(note) {
  await qa.note(note);
  await page.evaluate(async () => {
    const el = document.querySelector('.live-wrap') ?? document.scrollingElement;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
  });
  await page.waitForTimeout(900);
}

async function watchSendBlock() {
  await page.evaluate(() => {
    window.__sendTimeline = [];
    let last = '';
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector('.draft-send');
      const text = el ? el.innerText.replace(/\s+/g, ' ').trim() : '(none)';
      if (text !== last) window.__sendTimeline.push({ ms: Math.round(performance.now() - t0), text });
      last = text;
    };
    new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, characterData: true });
    tick();
  });
}

// 0. Seed: discovery + his CV's facts + magic-link sign-in.
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await postJson('/api/onboarding/discovery/start', { role: ROLE });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`his CV gave the session no facts (${facts})`);
await qa.note(`his CV was read and reviewed — ${facts} facts on his record`);
const link = await postJson('/api/auth/request-link', { email: EMAIL });
if (!link.body?.devLink) throw new Error(`sign-in failed (${link.status}): ${JSON.stringify(link.body)}`);
await postJson('/api/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });
await qa.note(`signed in as ${EMAIL}`);

// 1. Deck -> want -> Tailor -> "I'm done" -> the draft.
await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the deck card renders');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — I want this one');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), "I'm done — use this CV");
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the tailored CV draft is shown');
await readThrough('read down through the draft to the send block');

const before = await api('/api/onboarding/tailor/draft');
const draftedAt = before.body?.draftedAt;
const bulletsBefore = (before.body?.html?.match(/<li>/g) ?? []).length;
await qa.note(`draft on screen: draftedAt=${draftedAt}, notices=${JSON.stringify(before.body?.conservationNotices)}`);
await assert(!(before.body?.conservationNotices ?? []).includes(NOTICE), 'before the press, no page notice exists');

// 2. Press once. The press tightens once, still measures 3, ships, and says so.
const callsBefore = await tailorCalls();
await watchSendBlock();
const approveResponse = page.waitForResponse((r) => r.url().includes('/api/onboarding/tailor/approve'));
await qa.click(page.getByRole('button', { name: S1 }), 'press "Approve and email me this CV" — once');
const approveRes = await approveResponse;
const jobId = (await approveRes.json().catch(() => ({}))).jobId;
await assert(approveRes.status() === 202, `the press is accepted (${approveRes.status()})`);

await qa.expectText('.draft-send', S6, 'it shipped anyway — never a hard failure');
await qa.expectText('.draft-send', `Sent to ${EMAIL}.`, 'the confirmation names his own address');
await qa.expectText('.draft-send .draft-notice', NOTICE, 'the screen says plainly that it still runs over two pages');
const sendNotices = await page.locator('.draft-send .draft-notice').count();
await assert(sendNotices === 1, `exactly one notice in the send block (found ${sendNotices})`);
const timeline = await page.evaluate(() => window.__sendTimeline);
await qa.note(`send-block timeline: ${JSON.stringify(timeline)}`);
await qa.note(
  timeline.some((t) => t.text.includes(S9))
    ? `"${S9}" reached the screen live`
    : `"${S9}" was not caught live (the fake re-tailor is instant; the mocked spec #314 proves the render)`,
);

const callsAfter = await tailorCalls();
await assert(callsAfter - callsBefore === 1, `exactly one re-tailor model call for the press (tailor calls ${callsBefore} -> ${callsAfter})`);

// 3. Over the wire: the job record and the stored draft.
const job = await api(`/api/jobs/${jobId}`);
const exported = job.body?.progress?.tailorExport ?? {};
await qa.note(`job record: status=${job.body?.status} tailorExport=${JSON.stringify(exported)}`);
await assert(
  job.body?.status === 'completed' && exported.step === 'sent' && exported.pages === 3 && exported.email === EMAIL,
  'job record: completed, step "sent", 3 pages (measured after the retry), his address',
);
await assert((exported.notices ?? []).includes(NOTICE), 'job record carries the page notice — the same list the email text is built from');

const after = await api('/api/onboarding/tailor/draft');
await qa.note(`draft after: draftedAt=${after.body?.draftedAt} notices=${JSON.stringify(after.body?.conservationNotices)}`);
await assert((after.body?.conservationNotices ?? []).includes(NOTICE), 'the stored draft now carries the page notice');
await assert(after.body?.draftedAt === draftedAt, 'the shortened document keeps the approved draftedAt (no new press needed)');
await qa.note(`printed bullets: ${bulletsBefore} before, ${(after.body?.html?.match(/<li>/g) ?? []).length} after the re-tailor`);

// 4. Reload: the notice is on the draft screen in its normal place, said once.
await qa.goto('/tailor', 'reload the tailor screen');
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), "I'm done — use this CV (the ending is screen state)");
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await readThrough('scroll through the draft after the send');
await qa.expectText('body', NOTICE, 'after a reload the page notice is on the draft screen');
const said = await page.getByText(NOTICE, { exact: false }).count();
await assert(said === 1, `the page notice is said once after reload (found ${said})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
