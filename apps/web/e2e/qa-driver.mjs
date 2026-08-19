// qa-driver.mjs — human-paced Playwright QA driver with highlighted-evidence
// screenshots and a self-contained HTML report. CLI-driven (run with `node`),
// never the Playwright MCP.
//
// Usage from a flow file:
//   import { createSession } from './qa-driver.mjs';
//   const qa = await createSession('checkout', { baseURL: 'http://localhost:3000' });
//   await qa.goto('/');
//   await qa.click('button[data-testid="cart"]', 'open the cart');
//   await qa.expectVisible('.cart-drawer', 'cart drawer is shown');
//   const ok = await qa.finish();            // writes report, closes browser
//   process.exit(ok ? 0 : 1);                // CI-friendly exit code
//
// Env knobs:
//   QA_PAUSE_MS   pause between actions (default 1000 — human pacing)
//   QA_HEADED=1   run headed (default headless, for CI)
//   QA_OUT        output root dir (default ./qa-results)
//
// Self-check (no browser needed):  node qa-driver.mjs --selftest

import fs from 'node:fs';
import path from 'node:path';

const PAUSE_MS = Number(process.env.QA_PAUSE_MS ?? 1000);
const HEADED = process.env.QA_HEADED === '1';
const OUT_ROOT = process.env.QA_OUT ?? 'qa-results';

const stamp = () =>
  new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d+)/, '$1-$2');

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function createSession(name, { baseURL = '', outDir = OUT_ROOT, viewport = { width: 1280, height: 800 } } = {}) {
  const runDir = path.join(outDir, `${name}-${stamp()}`);
  const shotsDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const steps = [];
  let shotN = 0;
  let finishPromise = null;
  let aborting = false;

  const { chromium } = await import('@playwright/test'); // lazy: report renderer/selftest need no browser
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ baseURL: baseURL || undefined, viewport });
  const page = await context.newPage();

  const pause = () => page.waitForTimeout(PAUSE_MS);

  // Outline the target locator (any Playwright locator), screenshot the viewport
  // so the highlighted element sits in context, then restore the element.
  async function highlightShot(loc) {
    let outlined = null;
    if (loc) {
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        await loc.evaluate((el) => {
          el.dataset.qaPrevOutline = el.style.outline;
          el.dataset.qaPrevShadow = el.style.boxShadow;
          el.style.outline = '3px solid #ff2d55';
          el.style.outlineOffset = '2px';
          el.style.boxShadow = '0 0 0 4px rgba(255,45,85,0.35)';
        });
        outlined = loc;
      } catch { /* non-highlightable target: fall back to plain viewport shot */ }
    }
    const buf = await page.screenshot({ fullPage: false });
    if (outlined) {
      try {
        await outlined.evaluate((el) => {
          el.style.outline = el.dataset.qaPrevOutline || '';
          el.style.boxShadow = el.dataset.qaPrevShadow || '';
        });
      } catch { /* element may have detached — evidence already captured */ }
    }
    return buf;
  }

  function record(action, target, note, status, error, buf) {
    shotN += 1;
    const file = `${String(shotN).padStart(2, '0')}-${action}.png`;
    if (buf) fs.writeFileSync(path.join(shotsDir, file), buf);
    steps.push({
      n: shotN, action, target: target || '', note: note || '', status,
      error: error ? String(error.message || error) : '',
      img: buf ? buf.toString('base64') : '',
      file: buf ? `screenshots/${file}` : '',
    });
  }

  const loc = (target) => (typeof target === 'string' ? page.locator(target).first() : target);

  async function act(action, target, note, fn, { assert = false } = {}) {
    const l = target ? loc(target) : null;
    try {
      if (fn) await fn(l);
      const buf = await highlightShot(l);
      record(action, targetLabel(target), note, assert ? 'pass' : 'info', null, buf);
      await pause();
      return true;
    } catch (err) {
      let buf = null;
      try { buf = await highlightShot(l); } catch { /* page may be gone */ }
      record(action, targetLabel(target), note, 'fail', err, buf);
      await pause();
      return false;
    }
  }

  const targetLabel = (t) => (typeof t === 'string' ? t : t ? '<locator>' : '');

  const api = {
    page, context, runDir,

    /** #216 - the floor questions a session is CURRENTLY being asked, newest state first.
     *
     *  READ, never hard-coded. The floor is the visitor's placed job family's published research
     *  (#223 retired the seven-item stub; #216 made the shipped screen serve the researched floor),
     *  so a journey carrying a literal list of item ids is asserting whichever question set
     *  happened to ship the day it was written. That is not hypothetical: seven journeys did
     *  exactly that, every POST answered 404 `unknown_item`, no fact was recorded, and each one
     *  failed later and further away on a deck card whose "Where you fit" list was empty. Read the
     *  ids and the rot cannot come back.
     *
     *  Eligibility, date-hole and reader questions ride the same list and are deliberately excluded
     *  - they are not floor items and have their own journeys. */
    /** #63 - the deck once retrieval has FINISHED. The cards route never waits on provider latency
     *  (#245), so the first read reports `searching` with an empty deck and the real deck arrives on
     *  a later one. Before #63 that wait was invisible: the fixture pool answered the first read, so
     *  a journey could index cards[0] straight away and never notice. Now an unwaited read gets
     *  `cards[0] === undefined` and the journey reports a product defect that is really its own race.
     *
     *  Returns the settled body whatever the outcome - an empty pool and an outage are settled
     *  answers, not something to keep polling, so a journey asserting on those still gets them. */
    cardsWhenRetrieved: async ({ timeoutMs = 20000 } = {}) =>
      page.evaluate(async (limit) => {
        const deadline = Date.now() + limit;
        for (;;) {
          const res = await fetch('/api/onboarding/cards', { credentials: 'same-origin' });
          const body = res.ok ? await res.json() : null;
          if (!body || body.searching !== true || Date.now() > deadline) return body;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }, timeoutMs),

    floorQuestions: async () => {
      const state = await page.evaluate(async () => {
        const res = await fetch('/api/onboarding/discovery', { credentials: 'same-origin' });
        return res.ok ? res.json() : null;
      });
      return (state?.questions ?? []).filter((q) => !q.eligibility);
    },

    /** #216 - seed this session's floor answers over the wire. Runs in-page, not via
     *  `page.request`: the session cookie is Secure, and Playwright's request context (correctly)
     *  will not attach a Secure cookie over http://127.0.0.1, while the real browser page gets the
     *  loopback "potentially trustworthy origin" exception - same reason every other in-page fetch
     *  in these journeys exists.
     *
     *  `no: true` answers the LAST floor item with a bare "No", so a journey can still exercise the
     *  asked-and-closed path the retired stub's hard-coded "No" used to give it. Returns the ids
     *  answered, so a caller can assert what it actually seeded. */
    seedFloorAnswers: async ({ yes = 'Yes, across three vendor teams', no = false } = {}) => {
      const ids = (await api.floorQuestions()).map((q) => q.itemId);
      if (ids.length === 0) return [];
      return page.evaluate(
        async ([itemIds, yesText, wantNo]) => {
          const answered = [];
          const refused = [];
          for (let i = 0; i < itemIds.length; i += 1) {
            const last = i === itemIds.length - 1;
            const res = await fetch('/api/onboarding/discovery/answer', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                itemId: itemIds[i],
                answer: wantNo && last ? 'No' : yesText,
              }),
            });
            // A 404 here means the ids went stale again. Collect the failures rather than seeding
            // nothing quietly - a short list is how the last drift stayed invisible for weeks.
            if (res.ok) answered.push(itemIds[i]);
            else refused.push(`${itemIds[i]} -> ${res.status}`);
          }
          if (refused.length > 0) throw new Error(`discovery refused ${refused.length} floor answer(s): ${refused.join(', ')}`);
          return answered;
        },
        [ids, yes, no],
      );
    },

    /** #216 - answer WHICHEVER question is currently on screen, whatever shape its control is.
     *
     *  The researched family floor mixes tap-an-option items with type-your-own ones (2 of the 4 in
     *  `it-project-delivery` v1 are free text). The retired seven-item stub was all options, so
     *  every journey that walked the screen by clicking `.opts .opt` in a loop now stalls the moment
     *  a free-text item comes up - 8s per attempt, then a run that aborts far from the cause. Use
     *  this instead of a bare click when the point is "keep answering until X appears".
     *
     *  Returns true if it answered something, false if no answerable control was on screen. */
    answerVisibleQuestion: async ({ freeText = 'Yes, across three vendor teams', note } = {}) => {
      const opts = page.locator('.opts button.opt, .opts .opt');
      const free = page.locator('#floor-free');
      if (await opts.count()) {
        const count = await opts.count();
        let chosen = opts.first();
        for (let k = 0; k < count; k += 1) {
          if (!/^no[.!]?$/i.test((await opts.nth(k).innerText()).trim())) { chosen = opts.nth(k); break; }
        }
        await api.click(chosen, note || `she presses "${(await chosen.innerText()).trim()}"`);
        return true;
      }
      if (await free.count()) {
        await api.fill('#floor-free', freeText, note || 'she types her own answer');
        await api.click('.ask button.go', 'Continue - she sends her typed answer');
        return true;
      }
      return false;
    },

    /** #216 - answer the floor by pressing the screen's OWN controls, the way a person does.
     *  Slower than seedFloorAnswers and worth it wherever the claim under test is "the button she
     *  presses is what moves her record". Handles both shapes the researched floor uses:
     *  tap-an-option and type-your-own - the retired stub was all options, which is why every
     *  journey looping on `.opts .opt` alone now stalls on the free-text items. */
    answerFloorOnScreen: async ({ limit = 8, freeText = 'Yes, across three vendor teams' } = {}) => {
      const asked = [];
      for (let i = 0; i < limit; i += 1) {
        const next = (await api.floorQuestions())[0];
        if (!next) break;
        // The screen types the answered item's CV line out before rendering the next question, so
        // the control lands a beat after the state does.
        try {
          await page.locator('.opts button.opt, #floor-free').first().waitFor({ state: 'visible', timeout: 20000 });
        } catch {
          await api.note(`the screen never offered a control for "${next.itemId}" - stopping the answer loop`);
          break;
        }
        const opts = page.locator('.opts button.opt');
        const count = await opts.count();
        if (count > 0) {
          let chosen = opts.first();
          for (let k = 0; k < count; k += 1) {
            if (!/^no[.!]?$/i.test((await opts.nth(k).innerText()).trim())) { chosen = opts.nth(k); break; }
          }
          await api.click(chosen, `she is asked "${next.question.slice(0, 70)}" - she presses "${(await chosen.innerText()).trim()}"`);
        } else {
          await api.fill('#floor-free', freeText, `she is asked "${next.question.slice(0, 70)}" - she types her own answer`);
          await api.click('.ask button.go', 'Continue - she sends her typed answer');
        }
        await page.waitForTimeout(1200);
        asked.push(next.itemId);
      }
      return asked;
    },

    goto: (url, note) =>
      act('goto', null, note || `navigate to ${url}`, async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
      }),

    click: (target, note) => act('click', target, note, (l) => l.click({ timeout: 8000 })),

    fill: (target, value, note) =>
      act('fill', target, note || `type into ${targetLabel(target)}`, (l) => l.fill(value, { timeout: 8000 })),

    press: (target, key, note) => act('press', target, note || `press ${key}`, (l) => l.press(key)),

    // Human reading pass: scroll down the page in steps, then back to top.
    scrollThrough: (note) =>
      act('scroll', null, note || 'scroll through the page', async () => {
        await page.evaluate(
          (pauseMs) =>
            new Promise((res) => {
              let y = 0;
              const tick = () => {
                window.scrollBy(0, 320);
                y += 320;
                if (y < document.body.scrollHeight - window.innerHeight) setTimeout(tick, pauseMs);
                else res();
              };
              tick();
            }),
          Math.max(120, PAUSE_MS / 4),
        );
        await page.evaluate(() => window.scrollTo({ top: 0 }));
      }),

    expectVisible: (target, note) =>
      act('expect-visible', target, note || `${targetLabel(target)} is visible`, async (l) => {
        if (!(await l.isVisible())) throw new Error(`not visible: ${targetLabel(target)}`);
      }, { assert: true }),

    expectText: (target, text, note) =>
      act('expect-text', target, note || `${targetLabel(target)} contains "${text}"`, async (l) => {
        const got = (await l.textContent()) || '';
        if (!got.includes(text)) throw new Error(`expected "${text}", got "${got.trim().slice(0, 120)}"`);
      }, { assert: true }),

    note: (text) => act('note', null, text, null),

    finish() {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        removeCrashHandlers();
        for (const [target, close] of [
          ['browser context', () => context.close()],
          ['browser', () => browser.close()],
        ]) {
          try {
            await close();
          } catch (error) {
            record('cleanup', target, `failed to close ${target}`, 'fail', error, null);
          }
        }
        const passed = steps.filter((s) => s.status === 'pass').length;
        const failed = steps.filter((s) => s.status === 'fail').length;
        const reportPath = path.join(runDir, 'report.html');
        fs.writeFileSync(reportPath, renderReport({ name, passed, failed, steps }));
        // eslint-disable-next-line no-console
        console.log(`\nQA "${name}": ${passed} passed, ${failed} failed`);
        console.log(`Report: ${reportPath}`);
        return failed === 0;
      })();
      return finishPromise;
    },
  };

  async function abort(event, error) {
    if (aborting) return;
    aborting = true;
    // #205: print FIRST, before anything that can throw. A crash whose report write also fails used
    // to exit 1 with no output at all — a red journey that says nothing is indistinguishable from
    // one nobody ran, which is the exact rot #205's audit was chasing. Found by that audit:
    // master-cv-dates-note-journey.mjs died silently and took a rebuild to diagnose.
    console.error(`RUN ABORTED (${event}):`, error);
    let buf = null;
    try { buf = await highlightShot(null); } catch { /* page may already be gone */ }
    record('run-aborted', '', `RUN ABORTED (${event})`, 'fail', error, buf);
    try { await api.finish(); } catch { /* preserve the original crash as the process failure */ }
    process.exit(1);
  }

  function onUncaughtException(error) {
    void abort('uncaughtException', error);
  }

  function onUnhandledRejection(error) {
    void abort('unhandledRejection', error);
  }

  function removeCrashHandlers() {
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
  }

  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);

  return api;
}

export function renderReport({ name, passed, failed, steps }) {
  const badge = (s) =>
    s === 'pass' ? '<span class="b pass">PASS</span>'
      : s === 'fail' ? '<span class="b fail">FAIL</span>'
        : '<span class="b info">step</span>';
  const cards = steps.map((s) => `
    <div class="card ${s.status}">
      <div class="head"><span class="n">#${s.n}</span> ${badge(s.status)}
        <span class="act">${esc(s.action)}</span>
        ${s.target ? `<code>${esc(s.target)}</code>` : ''}</div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      ${s.img ? `<img alt="step ${s.n}" src="data:image/png;base64,${s.img}">` : '<div class="noimg">no screenshot</div>'}
    </div>`).join('\n');
  const overall = failed === 0 ? 'PASS' : 'FAIL';
  return `<!doctype html><html><head><meta charset="utf-8">
<title>QA report — ${esc(name)}</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#111}
  @media(prefers-color-scheme:dark){body{background:#16181d;color:#e8e8ea}.card{background:#1f2228!important;border-color:#333!important}code,.note{background:#2a2d34!important}}
  h1{margin:0 0 4px}
  .sum{font-size:18px;margin-bottom:20px}
  .sum .PASS{color:#1a7f37;font-weight:700}.sum .FAIL{color:#cf222e;font-weight:700}
  .card{background:#fff;border:1px solid #e2e4e8;border-radius:10px;padding:14px;margin:0 0 16px;max-width:960px}
  .card.fail{border-color:#cf222e}
  .head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  .n{color:#888;font-weight:700}
  .act{font-weight:600}
  .b{font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px;color:#fff}
  .b.pass{background:#1a7f37}.b.fail{background:#cf222e}.b.info{background:#57606a}
  code{background:#eef0f3;padding:1px 6px;border-radius:5px;font-size:13px}
  .note{background:#eef0f3;padding:6px 10px;border-radius:6px;margin:6px 0}
  .err{color:#cf222e;font-family:ui-monospace,monospace;font-size:13px;margin:6px 0;white-space:pre-wrap}
  img{max-width:100%;border:1px solid #d0d3d8;border-radius:6px;margin-top:8px;display:block}
  .noimg{color:#999;font-style:italic}
</style></head><body>
<h1>QA report — ${esc(name)}</h1>
<div class="sum">Overall: <span class="${overall}">${overall}</span> &nbsp;·&nbsp; ${passed} passed, ${failed} failed &nbsp;·&nbsp; ${new Date().toISOString()}</div>
${cards}
</body></html>`;
}

// --- self-check: report renders from synthetic steps, no browser required ---
if (process.argv[1] && process.argv[1].endsWith('qa-driver.mjs') && process.argv.includes('--selftest')) {
  const html = renderReport({
    name: 'selftest',
    passed: 1,
    failed: 1,
    steps: [
      { n: 1, action: 'goto', target: '', note: 'nav', status: 'info', error: '', img: '', file: '' },
      { n: 2, action: 'expect-visible', target: '.x', note: 'shown', status: 'pass', error: '', img: '', file: '' },
      { n: 3, action: 'expect-text', target: '.y', note: 'text', status: 'fail', error: 'expected "A", got "B"', img: '', file: '' },
    ],
  });
  const ok = html.includes('Overall: <span class="FAIL">FAIL</span>') && html.includes('expected &quot;A&quot;');
  console.log(ok ? 'selftest: PASS' : 'selftest: FAIL');
  process.exit(ok ? 0 : 1);
}
