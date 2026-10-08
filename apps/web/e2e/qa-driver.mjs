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

// factsFromCv's default CV: two dated IT project jobs and a degree — the shape most journeys paste.
export const SAMPLE_CV = [
  'Marta Kowalska',
  'marta.kowalska@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2018 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2013 - Feb 2018',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2013',
].join('\n');

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

    /** #338 - complete "Your CV, reviewed" over the wire, for a journey whose claim is not the
     *  review itself. A brought CV is reviewed before any job is shown (ADR-0016 clause 6): the deck,
     *  the want door and the tailor refuse an unreviewed session, and discovery's last answer hands
     *  off to /review instead of /deck. A journey that reads a CV and then wants its jobs calls this
     *  once, after the read has landed. Runs in-page, not via `page.request`: the session cookie is
     *  Secure, and Playwright's request context (correctly) will not attach a Secure cookie over
     *  http://127.0.0.1, while the real browser page gets the loopback "potentially trustworthy
     *  origin" exception. Returns the server's answer, so a caller can assert it happened.
     *
     *  #339: there is no floor to seed any more. Discovery asks question 1 and the eligibility
     *  questions only, and nothing but the completed review holds the jobs back - a journey that
     *  needs a fact gets it from the CV it reads, or from the tailor step's own questions. */
    completeReview: async () =>
      page.evaluate(async () => {
        // #341: the confirm is refused (409) while the review run is still going; on the fake stack
        // that is milliseconds, but a journey confirming right after the read lands can meet it.
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const res = await fetch('/api/review/complete', { method: 'POST', credentials: 'same-origin' });
          if (res.ok) return res.json();
          if (res.status !== 409) throw new Error(`review completion refused: ${res.status}`);
          await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error('review completion refused: the review run never finished');
      }),

    /** #339 - give a session confirmed facts the way a real visitor now gets them: she brings a CV,
     *  the read lands, and she confirms "Your CV, reviewed" (completing the review confirms every
     *  line the read found). For a journey that set its session up over the wire and needs facts on
     *  its cards - the floor answers that used to supply them are gone. Same POST /cv/paste route the
     *  front door's paste tile calls; the page must already be on the app's origin. Returns the
     *  number of confirmed facts the session holds afterwards, so a caller can assert it. */
    factsFromCv: async (cvText = SAMPLE_CV) => {
      const jobId = await page.evaluate(async (text) => {
        const res = await fetch('/api/cv/paste', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`CV paste refused: ${res.status} ${await res.text()}`);
        return (await res.json()).jobId;
      }, cvText);
      await api.waitForJobDone(jobId);
      await api.completeReview();
      return page.evaluate(async () => (await (await fetch('/api/onboarding/discovery')).json()).factCount);
    },

    /** Answer WHICHEVER option question is currently on screen by pressing its first option that is
     *  not a bare "No". #339: after question 1 discovery asks only eligibility (work rights per
     *  market, then languages), so this is a tap on an option button - the free-text floor box is
     *  gone. Use it when the point is "keep answering until X appears".
     *
     *  Returns true if it answered something, false if no answerable control was on screen. */
    answerVisibleQuestion: async ({ note } = {}) => {
      const opts = page.locator('.opts button.opt, .opts .opt');
      const count = await opts.count();
      if (count === 0) return false;
      let chosen = opts.first();
      for (let k = 0; k < count; k += 1) {
        if (!/^no[.!]?$/i.test((await opts.nth(k).innerText()).trim())) { chosen = opts.nth(k); break; }
      }
      await api.click(chosen, note || `she presses "${(await chosen.innerText()).trim()}"`);
      return true;
    },

    /** #271 - bring a CV in the way a person does: the front door's paste tile (#270), through to
     *  the facts-found screen. The deleted /paste screen used to be every journey's side entrance,
     *  and the deleted draft screen's address was how a journey learned its jobId - both now come
     *  from the front door itself: the walk is invitation -> "Paste my CV text" -> "Use this text",
     *  and the jobId is read off the paste response the page itself makes.
     *
     *  Works for a brand-new visitor (invitation showing) and for a session already on the source
     *  step. It does NOT work for a session whose stage has advanced to discovery - the front door
     *  restores such a visitor straight to the intent step, which is the product's own behaviour,
     *  so paste FIRST, intent after (the order a real visitor walks anyway). A journey needing a
     *  SECOND read on the same session has no screen for it - the product offers none - and calls
     *  POST /cv/paste directly, the same route this walk exercises.
     *
     *  Leaves the browser on "/" showing the facts screen; returns the read's jobId. */
    frontDoorPaste: async (cvText, note) => {
      await api.goto('/', note || 'the front door - she brings her CV in as a person does');
      const ready = page.getByRole('button', { name: 'Ready?' });
      const pasteTile = page.getByRole('button', { name: /Paste my CV text/ });
      await ready.or(pasteTile).first().waitFor({ state: 'visible', timeout: 30000 });
      if (await ready.isVisible().catch(() => false)) {
        await page.mouse.click(10, 10); // finish the invitation animation
        await api.click(ready, 'Ready? - through the invitation');
      }
      await api.click(pasteTile, 'chooses "Paste my CV text" on the source step');
      await api.fill(page.getByLabel('Your CV text'), cvText, 'pastes the CV');
      const pasteResponse = page.waitForResponse(
        (r) => r.url().includes('/api/cv/paste') && r.request().method() === 'POST',
        { timeout: 30000 },
      );
      await api.click(page.getByRole('button', { name: 'Use this text' }), 'hands it over');
      const { jobId } = await (await pasteResponse).json();
      // #325: a good read hands straight on to the job question; only a read she must act on
      // (partial, failed, nothing useful) stops on a screen with buttons.
      const intentHeading = page.getByRole('heading', { name: /What kind of job are you going for/ });
      await intentHeading.or(page.locator('.import-actions')).first().waitFor({ state: 'visible', timeout: 120000 });
      const heading = ((await page.locator('.import-status h1, .intent-screen h1').first().textContent().catch(() => '')) || '').trim();
      await api.note(`the read finished - the screen says "${heading}" (jobId ${jobId})`);
      return jobId;
    },

    /** #271 - on to the target-role and search-area step. #325: a good read is already there; a
     *  partly-read CV still stops on its own screen and needs the press. */
    frontDoorContinueToIntent: async () => {
      const intentHeading = page.getByRole('heading', { name: /What kind of job are you going for/ });
      if (!(await intentHeading.isVisible().catch(() => false))) {
        await api.click(page.getByRole('button', { name: /Ask me what/ }), 'continues to what is missing');
      }
      await intentHeading.waitFor({ state: 'visible', timeout: 30000 });
    },

    /** #271 - wait out the read's whole pipeline, the sync point the old flow got for free by
     *  sitting on the wait screen until it navigated to the draft. Journeys that open
     *  /job-blocks/<jobId> straight after a read need it; the facts screen appears mid-pipeline. */
    waitForJobDone: async (jobId, { timeoutMs = 180000 } = {}) => {
      await page.waitForFunction(
        async (id) => {
          const r = await fetch(`/api/jobs/${id}`, { credentials: 'same-origin' });
          if (!r.ok) return false;
          const j = await r.json();
          return j.status === 'completed' || j.status === 'failed';
        },
        jobId,
        { timeout: timeoutMs, polling: 1000 },
      );
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
