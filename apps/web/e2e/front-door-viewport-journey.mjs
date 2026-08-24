// front-door-viewport-journey.mjs — the front door is a full-bleed overlay at every width.
//
// Why this exists: `.frontdoor` is the ONE HUD screen rendered as <main> (discovery/deck/tailor are
// <div>), so it alone inherited globals.css's `main { max-width: 640px; padding: … }`. A
// `position: fixed; inset: 0` element with a max-width does not fill the viewport — it renders as a
// 640px centred column, and the light `.brandbar` (its "JobCrush" wordmark in `--jc-accent`, the
// light `--jc-font`) showed either side of it on every desktop screen. frontdoor.css now pins
// `max-width: none; padding: 0`, and this journey is the regression guard for that.
//
// Run:  node e2e/front-door-viewport-journey.mjs            (needs a web dev server)
//       QA_BASE_URL=http://127.0.0.1:3417 node e2e/front-door-viewport-journey.mjs
//
// The API is route-stubbed: this asserts layout, and the front door's own session restore is not
// what is under test. Without a stub a backend-less load shows the restore error instead of the
// invitation, which would hide the very content whose position is the point.

import { createSession } from './qa-driver.mjs';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3417';

// The HUD ground the overlay paints, from frontdoor.css's `--hud-0`.
const HUD_0 = [0x10, 0x14, 0x19];
// A screenshot pixel is "the HUD" if every channel is within this of --hud-0. Not zero: the page
// renders at the device scale factor and a corner can pick up a hair of antialiasing.
const RGB_TOLERANCE = 4;

const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'ultra-wide 1920x1080', width: 1920, height: 1080 },
  { name: 'tablet 768x1024', width: 768, height: 1024 },
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'phone 360x640', width: 360, height: 640 },
];

/** Assert with a highlighted-evidence screenshot of the element the claim is about.
 *
 *  The driver only records pass/fail through its own locator assertions, so the verdict is stamped
 *  onto the element under test and asserted through an attribute selector: a false verdict matches
 *  nothing, which the driver records as a FAIL with a screenshot. The numbers ride in the note, so
 *  the report reads as evidence rather than a bare red badge. */
async function check(qa, selector, ok, note) {
  await qa.page
    .locator(selector)
    .first()
    .evaluate((el, verdict) => el.setAttribute('data-qa-check', verdict ? 'ok' : 'bad'), ok)
    .catch(() => {});
  await qa.expectVisible(`${selector}[data-qa-check="ok"]`, note);
  return ok;
}

/** Sample real pixels out of the rendered screenshot.
 *
 *  Decoded in-page through a canvas rather than with a PNG library — no new dependency, and it is
 *  the same bytes the report embeds. Points are viewport fractions so one list serves every width. */
async function samplePixels(page, points) {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ([data, pts]) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = `data:image/png;base64,${data}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return pts.map(({ label, fx, fy }) => {
        const x = Math.min(Math.round(fx * img.width), img.width - 1);
        const y = Math.min(Math.round(fy * img.height), img.height - 1);
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { label, x, y, rgb: [d[0], d[1], d[2]] };
      });
    },
    [b64, points],
  );
}

const EDGE_POINTS = [
  { label: 'top-left', fx: 0.002, fy: 0.002 },
  { label: 'top-right', fx: 0.998, fy: 0.002 },
  { label: 'bottom-left', fx: 0.002, fy: 0.998 },
  { label: 'bottom-right', fx: 0.998, fy: 0.998 },
  { label: 'left-edge-mid', fx: 0.002, fy: 0.5 },
  { label: 'right-edge-mid', fx: 0.998, fy: 0.5 },
  { label: 'top-edge-mid', fx: 0.5, fy: 0.004 },
  { label: 'bottom-edge-mid', fx: 0.5, fy: 0.996 },
];

const isHud = (rgb) => rgb.every((c, i) => Math.abs(c - HUD_0[i]) <= RGB_TOLERANCE);
const fmt = (p) => `${p.label} rgb(${p.rgb.join(',')})`;

/** Route-stub the session restore. `entered` picks which view the front door restores into. */
async function stubSession(page, { entered = false } = {}) {
  await page.unroute('**/api/sessions/me').catch(() => {});
  await page.route('**/api/sessions/me', (route) =>
    route.fulfill({
      json: { sourceEntry: entered ? { checkpoint: 'invited', choice: null } : null },
    }),
  );
}

async function main() {
  const qa = await createSession('front-door-viewport', {
    baseURL: BASE_URL,
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
  });
  let allOk = true;
  const record = (ok) => {
    allOk = allOk && ok;
  };

  await stubSession(qa.page);

  // ---- AC1 + AC2: the overlay fills a desktop screen, and nothing of the site header shows ----
  for (const vp of VIEWPORTS.filter((v) => v.width >= 768)) {
    await qa.page.setViewportSize({ width: vp.width, height: vp.height });
    await qa.goto('/', `she opens the landing page on a ${vp.name} screen`);
    await qa.page.mouse.click(10, 10); // let the typed headline finish
    await qa.page.waitForTimeout(600);

    const geom = await qa.page.evaluate(() => {
      const el = document.querySelector('main.frontdoor');
      const r = el.getBoundingClientRect();
      const brand = document.querySelector('header.brandbar > div > a');
      const br = brand ? brand.getBoundingClientRect() : null;
      const hitAtBrand = brand
        ? document.elementFromPoint(
            Math.max(1, Math.min(br.left + br.width / 2, window.innerWidth - 1)),
            Math.max(1, Math.min(br.top + br.height / 2, window.innerHeight - 1)),
          )
        : null;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
        maxWidth: getComputedStyle(el).maxWidth,
        padding: getComputedStyle(el).padding,
        brandRect: br && { left: br.left, top: br.top, width: br.width, height: br.height },
        brandText: brand ? brand.textContent.trim() : null,
        hit: hitAtBrand && {
          tag: hitAtBrand.tagName,
          cls: String(hitAtBrand.className || ''),
          insideFrontDoor: !!hitAtBrand.closest('main.frontdoor'),
          isTheWordmarkLink: hitAtBrand === brand,
        },
      };
    });

    const fills =
      geom.rect.left <= 0 &&
      geom.rect.top <= 0 &&
      geom.rect.width >= geom.innerWidth &&
      geom.rect.height >= geom.innerHeight;
    record(
      await check(
        qa,
        'main.frontdoor',
        fills,
        `AC1 ${vp.name} — the dark screen covers the whole window: overlay ${Math.round(geom.rect.width)}x${Math.round(geom.rect.height)} at (${Math.round(geom.rect.left)},${Math.round(geom.rect.top)}) vs window ${geom.innerWidth}x${geom.innerHeight}; computed max-width "${geom.maxWidth}", padding "${geom.padding}"`,
      ),
    );

    const pixels = await samplePixels(qa.page, EDGE_POINTS);
    const bad = pixels.filter((p) => !isHud(p.rgb));
    record(
      await check(
        qa,
        'main.frontdoor',
        bad.length === 0,
        `AC1 ${vp.name} — every screen edge is the HUD ground #101419: ${pixels.map(fmt).join(' · ')}${bad.length ? ` — OFF-COLOUR: ${bad.map(fmt).join(', ')}` : ''}`,
      ),
    );

    const wordmarkHidden = !!geom.hit && !geom.hit.isTheWordmarkLink && geom.hit.insideFrontDoor;
    record(
      await check(
        qa,
        'main.frontdoor',
        wordmarkHidden,
        `AC2 ${vp.name} — the old light "${geom.brandText}" header wordmark is covered: at its own coordinates (${Math.round(geom.brandRect.left)},${Math.round(geom.brandRect.top)}) the top-most thing is <${geom.hit.tag} class="${geom.hit.cls}">, inside the front door = ${geom.hit.insideFrontDoor}, is the link itself = ${geom.hit.isTheWordmarkLink}`,
      ),
    );

    await qa.scrollThrough(`she looks down the ${vp.name} landing screen`);
  }

  // ---- AC4: removing the outer 640px cap must not have widened the inner column ----
  await qa.page.setViewportSize({ width: 1440, height: 900 });
  await stubSession(qa.page, { entered: true });
  await qa.goto('/', 'a returning visitor lands straight on the source-choice step (1440 wide)');
  await qa.page.locator('.source-screen').first().waitFor({ state: 'visible', timeout: 20000 });

  const col = await qa.page.evaluate(() => {
    const r = document.querySelector('.source-screen').getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      left: r.left,
      right: r.right,
      width: r.width,
      centreOffset: r.left + r.width / 2 - window.innerWidth / 2,
    };
  });
  record(
    await check(
      qa,
      '.source-screen',
      Math.abs(col.width - 420) < 1 && Math.abs(col.centreOffset) < 1,
      `AC4 1440x900 — the inner column is still a narrow centred 420px: width ${col.width.toFixed(1)}px, left ${col.left.toFixed(1)}, right ${col.right.toFixed(1)}, off-centre by ${col.centreOffset.toFixed(2)}px in a ${col.innerWidth}px window`,
    ),
  );
  await qa.scrollThrough('she reads the source-choice options');

  // ---- AC3 + the padding:0 regression probe: small screens, at the invitation ----
  await stubSession(qa.page, { entered: false });
  for (const vp of VIEWPORTS.filter((v) => v.width < 768).concat(VIEWPORTS.filter((v) => v.width === 768))) {
    await qa.page.setViewportSize({ width: vp.width, height: vp.height });
    await qa.goto('/', `she opens the landing page on a ${vp.name} screen`);
    await qa.page.mouse.click(10, 10);
    await qa.page.waitForTimeout(900);

    const small = await qa.page.evaluate(() => {
      const h = document.querySelector('.frontdoor .h').getBoundingClientRect();
      const ready = document.querySelector('.frontdoor .ready');
      const rr = ready ? ready.getBoundingClientRect() : null;
      // The padding:0 probe: the closest any front-door content gets to the window edge. `.invite`
      // carries its own `padding: 0 26px`, so nothing may sit flush against the glass.
      let minGap = Infinity;
      for (const el of document.querySelectorAll('.frontdoor .invite *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        minGap = Math.min(minGap, r.left, window.innerWidth - r.right);
      }
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        headline: { left: h.left, right: h.right, width: h.width, top: h.top, bottom: h.bottom },
        headlineOffCentre: h.left + h.width / 2 - window.innerWidth / 2,
        headlineText: document.querySelector('.frontdoor .h').innerText.replace(/\s+/g, ' ').trim(),
        ready: rr && { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, text: ready.textContent.trim(), disabled: ready.disabled },
        minEdgeGap: minGap === Infinity ? null : minGap,
      };
    });

    const headlineOk =
      small.headline.left >= 0 &&
      small.headline.right <= small.innerWidth &&
      small.headline.top >= 0 &&
      small.headline.bottom <= small.innerHeight &&
      Math.abs(small.headlineOffCentre) < 2 &&
      small.headlineText.includes('Answer questions.') &&
      small.headlineText.includes('Collect jobs.');
    record(
      await check(
        qa,
        '.frontdoor .h',
        headlineOk,
        `AC3 ${vp.name} — the headline reads in full and sits centred: "${small.headlineText}" spanning ${small.headline.left.toFixed(1)}–${small.headline.right.toFixed(1)} of ${small.innerWidth}px, off-centre by ${small.headlineOffCentre.toFixed(2)}px, vertical ${small.headline.top.toFixed(0)}–${small.headline.bottom.toFixed(0)} of ${small.innerHeight}px`,
      ),
    );

    const readyOk =
      !!small.ready &&
      !small.ready.disabled &&
      small.ready.left >= 0 &&
      small.ready.right <= small.innerWidth &&
      small.ready.top >= 0 &&
      small.ready.bottom <= small.innerHeight;
    record(
      await check(
        qa,
        '.frontdoor .ready',
        readyOk,
        `AC3 ${vp.name} — the "${small.ready ? small.ready.text : 'Ready?'}" button is on screen and pressable: box ${small.ready ? `${small.ready.left.toFixed(0)},${small.ready.top.toFixed(0)}–${small.ready.right.toFixed(0)},${small.ready.bottom.toFixed(0)}` : 'MISSING'} in ${small.innerWidth}x${small.innerHeight}, disabled = ${small.ready ? small.ready.disabled : 'n/a'}`,
      ),
    );

    record(
      await check(
        qa,
        'main.frontdoor',
        small.scrollWidth <= small.innerWidth && small.minEdgeGap >= 20,
        `AC3 ${vp.name} — nothing spills sideways and nothing touches the glass: page scrollWidth ${small.scrollWidth} vs window ${small.innerWidth}; closest content sits ${small.minEdgeGap === null ? 'n/a' : small.minEdgeGap.toFixed(1)}px from the edge (padding:0 on the overlay, .invite keeps its own 26px)`,
      ),
    );

    const pixels = await samplePixels(qa.page, EDGE_POINTS);
    const bad = pixels.filter((p) => !isHud(p.rgb));
    record(
      await check(
        qa,
        'main.frontdoor',
        bad.length === 0,
        `AC3 ${vp.name} — the dark ground still reaches every edge: ${pixels.map(fmt).join(' · ')}${bad.length ? ` — OFF-COLOUR: ${bad.map(fmt).join(', ')}` : ''}`,
      ),
    );

    await qa.scrollThrough(`she looks down the ${vp.name} landing screen`);
  }

  const clean = await qa.finish();
  process.exit(clean && allOk ? 0 : 1);
}

await main();
