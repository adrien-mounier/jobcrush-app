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
  new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d+)/, '$1-$2');

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function createSession(name, { baseURL = '', outDir = OUT_ROOT, viewport = { width: 1280, height: 800 } } = {}) {
  const runDir = path.join(outDir, `${name}-${stamp()}`);
  const shotsDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const steps = [];
  let shotN = 0;

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

    async finish() {
      const passed = steps.filter((s) => s.status === 'pass').length;
      const failed = steps.filter((s) => s.status === 'fail').length;
      const reportPath = path.join(runDir, 'report.html');
      fs.writeFileSync(reportPath, renderReport({ name, passed, failed, steps }));
      await context.close();
      await browser.close();
      // eslint-disable-next-line no-console
      console.log(`\nQA "${name}": ${passed} passed, ${failed} failed`);
      console.log(`Report: ${reportPath}`);
      return failed === 0;
    },
  };

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
