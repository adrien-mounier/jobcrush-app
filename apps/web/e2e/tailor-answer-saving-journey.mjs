// #398 — a slow answer in the Tailor queue says it is saving until it lands. On staging the owner's
// English answer sat still for ~8 s and a tester pressed again. The fake stack answers fast, so this
// flow holds the real answer request for 3 s (then lets it through to the real server) — the wait a
// person feels on the real model.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/tailor-answer-saving-journey.mjs
import { createSession } from './qa-driver.mjs';
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const MANDARIN_AD = liveAdId('2026-07-05_okx_senior-strategy-project-manager-vip-institutions');

const qa = await createSession('tailor-answer-saving', { baseURL: BASE, viewport: { width: 390, height: 844 } });
const { page } = qa;
page.setDefaultTimeout(15000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const stack = (on) =>
  page.evaluate((v) => fetch('/api/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ languageAdverts: v }) }).then((r) => r.status), on);

try {
  await qa.goto('/', 'the front door');
  await assert((await stack(true)) === 200, 'the QA stack serves the language adverts for this run');
  await qa.goto('/discovery', 'into discovery');
  await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), 'IT project manager in Hong Kong', 'type the role');
  await qa.click(page.getByRole('button', { name: "That's me" }), 'submit the role');
  await page.waitForURL(/\/(deck|profile\/check)/, { timeout: 30_000 });

  const signedIn = await page.evaluate(async () => {
    const r = await fetch('/api/auth/request-link', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `saving-${Date.now()}@example.com` }) });
    const { devLink } = await r.json();
    const token = new URL('http://x' + devLink).searchParams.get('token');
    return (await fetch('/api/auth/verify', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).ok;
  });
  await assert(signedIn, 'signed in');
  const wanted = await page.evaluate((id) => fetch(`/api/onboarding/cards/${encodeURIComponent(id)}/want`, { method: 'POST', credentials: 'include' }).then((r) => r.status), MANDARIN_AD);
  await assert(wanted === 200, `the Mandarin job is the one being tailored (HTTP ${wanted})`);

  await qa.goto('/tailor', 'open the Tailor step');
  await qa.expectText('.tailor .ask .q', 'Mandarin', 'the language question is asked');
  await qa.scrollThrough('read the question and its rungs');

  let posted = 0;
  await page.route('**/api/onboarding/tailor/profile-answer', async (route) => {
    posted += 1;
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  const rung = page.locator('.tailor .opts .opt', { hasText: 'I get by day to day' }).first();
  await rung.click();
  const saving = page.locator('.tailor .ask').getByRole('status');
  await qa.expectText(saving, 'Saving your answer…', 'while the answer is on its way, the screen says it is saving');
  await assert(await rung.isDisabled(), 'the rungs cannot be pressed a second time while it saves');
  await page.waitForFunction(() => !document.querySelector('.tailor .ask [role=status]'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await qa.expectText('.tailor .ledger', 'Remembered for Mandarin', 'once it lands, the saving line goes and the answer is confirmed');
  await assert(posted === 1, `the answer was sent once (${posted})`);
  await qa.note(`put the QA language adverts back: HTTP ${await stack(false)}`);
} catch (e) {
  await assert(false, `flow broke: ${e.message}`);
}
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
