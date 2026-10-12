// #376 — the start asks nothing after the upload; work rights are answered on check mode's last
// screen. Walked the way a person walks it, over the REAL stack (fake model only):
//
//   1. she pastes her CV on the front door and says what she is going for and where — and is taken
//      straight to her profile's check mode: no question between the upload and the profile;
//   2. she walks the screens to the last one, passing Languages (her CV's languages are its items);
//   3. Additional information opens with "Where you can work": one row for her market, the footer
//      button holding, naming the market — and the server refuses the finish too
//      (work_rights_unset), so the lock is not only on the screen;
//   4. she taps "Yes, I can work there", the button turns to the finish, and she finishes: the done
//      screen hands her on to the jobs, and the answer is on the server.
//
// Replaces eligibility-questions-journey.mjs in the gate: that journey walked the discovery
// questions this ticket removed (ADR-0018 clause 8). The CV's own proposal ("You're Australian, so
// I put yes.") is not walked here — the fake miner replays a recording with no nationality line;
// apps/api/test/workRightsCard.test.ts and cvReview.test.ts prove it, check-mode.spec.ts the screen.
//
//   PORT=34761 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34761 npx next build && npx next start -p 34760
//   BASE_URL=http://127.0.0.1:34760 node apps/web/e2e/check-mode-work-rights-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34760';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager';
const AREA = 'Singapore';

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.376@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

const qa = await createSession(`check-mode-work-rights-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const json = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null],
  );
const heading = page.getByRole('heading', { level: 1 });
const primary = page.locator('.foot .primary');

// Every question discovery could put on screen, and every answer sent to it, from here on.
let questionsSeen = 0;
const answersSent = [];
page.on('request', (r) => {
  if (r.url().includes('/api/onboarding/discovery/answer')) answersSent.push(r.url());
});

// ---------------------------------------------------------------------------------------------
// 1. The CV, the job and the place — then nothing asked: straight to check mode.
// ---------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes her CV');
await qa.waitForJobDone(jobId);
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
await qa.click('button:has-text("Save and continue")', 'Save and continue');
for (let i = 0; i < 40 && !/\/profile\/check/.test(page.url()); i += 1) {
  questionsSeen = Math.max(questionsSeen, await page.locator('.discovery .opts').count());
  await page.waitForTimeout(250);
}
await page.waitForURL(/\/profile\/check/, { timeout: 30_000 });
await assert(questionsSeen === 0 && answersSent.length === 0, `nothing was asked between the upload and her profile (questions seen ${questionsSeen}, answers sent ${answersSent.length})`);
await qa.expectText(heading, 'Your details', 'check mode opens on her details');

// ---------------------------------------------------------------------------------------------
// 2. The walk, to the last screen. Languages is one of them: her CV's languages are its items.
// ---------------------------------------------------------------------------------------------
let languagesItems = null;
for (let i = 0; i < 20 && (await heading.innerText()) !== 'Additional information'; i += 1) {
  const before = await heading.innerText();
  if (before === 'Languages') languagesItems = await page.locator('li.pt').count();
  await qa.click(primary, `Next, from "${before}"`);
  await page.waitForFunction((b) => document.querySelector('h1')?.textContent !== b, before);
}
await qa.expectText(heading, 'Additional information', 'the last screen');
await assert(languagesItems !== null && languagesItems > 0, `she passed Languages, listing her CV's languages (${languagesItems} items)`);

// ---------------------------------------------------------------------------------------------
// 3. Where you can work: one row, and the jobs held — on the screen and on the server.
// ---------------------------------------------------------------------------------------------
const rows = page.locator('.wrrow');
await qa.expectText('.wr .ctitle', 'Where you can work', 'the plain card at the top of the screen');
await assert((await rows.count()) === 1, `one row, for her one market (${await rows.count()})`);
await qa.expectText(rows.first().locator('legend'), AREA, 'the row names her market');
await qa.expectText(primary, `Answer ${AREA} to continue`, 'the button names the market still open');
await assert(await primary.isDisabled(), 'and holds');
// The background check may still be going on the fake stack; the work-rights refusal is the one
// left once it is done.
for (let i = 0; i < 40 && (await json('/review')).body?.progress; i += 1) await page.waitForTimeout(250);
const refused = await json('/review/complete', { method: 'POST' });
await assert(
  refused.status === 409 && refused.body?.error?.code === 'work_rights_unset',
  `the server refuses the finish too (${refused.status} ${refused.body?.error?.code})`,
);
await qa.scrollThrough('she reads the card');

// ---------------------------------------------------------------------------------------------
// 4. She answers, and finishes.
// ---------------------------------------------------------------------------------------------
await qa.click(rows.first().locator('.pill').first(), '"Yes, I can work there"');
await qa.expectText(primary, 'Finish my profile', 'the button turns to the finish');
await assert(await primary.isEnabled(), 'and opens');
const stored = (await json('/review')).body?.workRights ?? [];
await assert(
  stored.length === 1 && stored[0].answer === 'eligible',
  `her answer is on the server, in its own words (${JSON.stringify(stored.map((r) => [r.market, r.answer]))})`,
);
await qa.click(primary, 'Finish my profile');
await qa.expectText(heading, 'Your profile is ready', 'the done screen');
await qa.click('.donepanel .primary', 'Show me the job ads');
await page.waitForURL(/\/deck/, { timeout: 30_000 });
await assert((await json('/review')).body?.completed === true, 'check mode is finished on the server');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
