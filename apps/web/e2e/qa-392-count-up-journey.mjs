// #392 — the job count is the end of the loading wait, not a sentence of its own. Walked over the
// REAL stack (fake model only): she types the job she is going for, the "Finding jobs like yours…"
// box holds while her search runs, then the real count ticks up from 0 to its final number in that
// box. The old "new jobs are open right now." / "Keep going…" sentence never appears. Under reduced
// motion the only number she ever sees is the final one.
//
// The search answers in one go on the fake stack, so the browser holds the start request ~2.5 s
// (the server still answers for real) — only so the wait box can be seen and photographed.
//
//   PORT=34201 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34201 npx next build && npx next start -p 34200
//   BASE_URL=http://127.0.0.1:34200 node apps/web/e2e/qa-392-count-up-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34200';
const ROLE = 'IT project manager';
const assert = (qa, cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Every number the count slot ever shows, in order, recorded inside the page so nothing races the tick.
const recordShown = (page) =>
  page.addInitScript(() => {
    const shown = (window.shownCounts = []);
    window.sawWaitBox = false;
    new MutationObserver(() => {
      const box = document.querySelector('.promise');
      if (box?.classList.contains('blind') && box.textContent.includes('Finding jobs like yours')) window.sawWaitBox = true;
      const t = document.querySelector('.promise .n')?.textContent;
      if (t && /^\d+$/.test(t) && t !== shown.at(-1)) shown.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

async function walk(name, reduced) {
  const qa = await createSession(name, { baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const { page } = qa;
  page.setDefaultTimeout(20_000);
  try {
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordShown(page);
    await page.route('**/api/onboarding/discovery/start', async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ response: res });
    });
    await qa.goto('/discovery', `discovery screen${reduced ? ' (reduced motion)' : ''}`);
    await qa.scrollThrough('read the screen before answering');
    await qa.fill('#q1-role', ROLE, `type the job she is going for — "${ROLE}"`);
    await page.locator("button.go.wide").click();
    await qa.expectText('.promise.blind', 'Finding jobs like yours…', 'while her search runs, the box reads "Finding jobs like yours…"');
    const n = page.locator('.promise:not(.blind) .n');
    await n.waitFor();
    const early = await n.textContent();
    if (!reduced) await qa.expectVisible('.promise:not(.blind)', `the count box mid-tick (read "${early}" as it appeared)`);
    const sr = page.locator('.promise .sr-only');
    await page.waitForFunction(() => {
      const b = document.querySelector('.promise');
      return b && b.querySelector('.sr-only')?.textContent.startsWith(`${b.querySelector('.n')?.textContent} `);
    });
    const final = Number(await n.textContent());
    const shown = (await page.evaluate(() => window.shownCounts)).map(Number);
    qa.note(`numbers shown in the count slot, in order: ${shown.join(' → ')}; screen-reader text: "${await sr.textContent()}"`);
    await assert(qa, await page.evaluate(() => window.sawWaitBox), 'the wait box was on screen before the count landed');
    await assert(qa, final > 0 && shown.at(-1) === final, `the count lands on its real number (${final})`);
    if (reduced) {
      await assert(qa, shown.length === 1 && shown[0] === final, `reduced motion: only the final number is ever shown (${shown.join(',')})`);
    } else {
      await assert(qa, shown[0] === 0 && shown.length > 3, `the count ticks up from 0 (${shown.length} steps)`);
      await assert(qa, shown.every((v, i) => i === 0 || v >= shown[i - 1]), 'the count only ever climbs');
    }
    await qa.expectText('.promise', 'like yours found.', 'the count reads "N jobs like yours found."');
    const body = await page.locator('body').innerText();
    await assert(qa, !body.includes('new jobs are open right now'), 'the old "new jobs are open right now." sentence is gone');
    await assert(qa, !body.includes('Keep going and I'), 'the old "Keep going…" tail is gone');
    await qa.scrollThrough('read the screen with the count landed');
    await qa.expectVisible('.discovery .handoff .go', 'the flow goes straight on to the hand-off, no count screen in between');
  } catch (e) {
    await assert(qa, false, `run error: ${e.message}`);
  }
  return qa.finish();
}

const ok = (await walk('qa-392-count-up', false)) & (await walk('qa-392-count-up-reduced-motion', true));
process.exit(ok ? 0 : 1);
