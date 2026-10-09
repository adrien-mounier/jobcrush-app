// #361 QA gate — the third job family, product-management ("Product Manager", product owner inside
// it), walked over the REAL stack (fake model only):
//
//   1. she pastes her CV and types "Product Owner" as the job she wants — the live server places it
//      in the Product Manager family (id AND version pinned on her own session), no question asked;
//   2. the review screen still drafts her IT project manager job against ITS family's must-haves
//      (publishing a third family moved no older placement);
//   3. over the wire, the job-family correction door now accepts product-management v1 and names it
//      "Product Manager"; an unpublished version is still refused;
//   4. no session -> 401.
//
// WHAT THIS CANNOT WALK, and why: the QA stack mines a canned CV (qa-main.ts JOB_BLOCKS — a Nordic IT
// project manager job and a Baltic coordinator job) whatever text is pasted, and the review prompt is
// fixed when the run starts, so no "Product Owner" PAST job can reach the review screen here. The
// review half of #361 (a product-management job gets all five must-haves drafted) is proven by
// apps/api/test/cvReviewRun.test.ts against the real published floor; the real-model placement of
// "Product Owner" by the family-labeler grid (pm-01).
//
//   PORT=34161 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34161 npx next build && npx next start -p 30361
//   BASE_URL=http://127.0.0.1:30361 node apps/web/e2e/product-owner-family-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30361';
const ROLE = 'Product Owner';
const AREA = 'Singapore';

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.361@example.com',
  'Ho Chi Minh City, Vietnam',
  '',
  'EXPERIENCE',
  '',
  'Product Owner, Okoone, Ho Chi Minh City — Jan 2023 - Present',
  '- Owned the product backlog for a client web platform and prioritised it with the business.',
  '- Built and maintained the product roadmap with stakeholders.',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Dec 2022',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
].join('\n');

const qa = await createSession('product-owner-family-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Ask the API the way her own browser would, and paint the answer on the page so the screenshot
// carries the bytes the server sent this session.
async function wire(method, path, body, opts = {}) {
  const result = await page.evaluate(
    async ([m, p, b, omit]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: omit ? 'omit' : 'same-origin',
        ...(b ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, text, json };
    },
    [method, path, body ?? null, !!opts.omit],
  );
  await page.evaluate(
    ([label, r]) => {
      let box = document.querySelector('#qa-wire');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'qa-wire';
        box.style.cssText =
          'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#111;color:#0f0;' +
          'font:11px/1.4 monospace;padding:10px;border-radius:8px;white-space:pre-wrap;max-height:45vh;overflow:auto';
        document.body.appendChild(box);
      }
      box.textContent = `${label}\nHTTP ${r.status}\n${r.text.slice(0, 1500)}`;
    },
    [`${method} /api${path}`, result],
  );
  return result;
}
const clearWire = () => page.evaluate(() => document.querySelector('#qa-wire')?.remove());

try {
  // ------------------------------------------------------------------------------------------
  // 1. Her CV, and "Product Owner" as the job she wants.
  // ------------------------------------------------------------------------------------------
  await qa.goto('/', 'the front door');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV (a Product Owner job at Okoone first)');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
  await qa.goto('/discovery', 'the questions the CV cannot answer');
  await page.waitForTimeout(2000);
  await qa.scrollThrough('she reads the discovery screen');

  const me = await wire('GET', '/sessions/me');
  await qa.expectVisible('#qa-wire', 'her own stored discovery record, verbatim');
  const plan = me.json?.discovery;
  await assert(
    plan?.questionFloors?.[0]?.familyId === 'product-management' && plan?.questionFloors?.[0]?.version === 1,
    `"Product Owner" is placed in the product-management family, v1 (${JSON.stringify(plan?.questionFloors)})`,
  );
  await assert(
    plan?.searchFamily?.familyId === 'product-management',
    `her job search runs on that family (${JSON.stringify(plan?.searchFamily)})`,
  );
  await clearWire();

  for (let i = 0; i < 8 && !/\/review/.test(page.url()); i += 1) {
    await page.waitForTimeout(1500);
    if (/\/review/.test(page.url())) break;
    const multiDone = page.locator('.discovery .elig-actions .go');
    if (await multiDone.count()) { await qa.click(multiDone.first(), 'finishes the multi-select question'); continue; }
    if (!(await qa.answerVisibleQuestion({ note: `answers the question on screen (${i + 1})` }))) {
      const later = page.getByRole('button', { name: 'Ask me later', exact: true });
      if (await later.count()) await qa.click(later.first(), 'ask me later');
      else break;
    }
  }
  await page.waitForURL(/\/review/, { timeout: 20_000 });

  // ------------------------------------------------------------------------------------------
  // 2. The review: her IT project manager job still drafted against its own family.
  // ------------------------------------------------------------------------------------------
  await page.getByRole('status').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await qa.scrollThrough('she reads her reviewed CV');
  const review = (await wire('GET', '/review')).json;
  await clearWire();
  const jobs = review?.sections?.find((s) => s.tag === 'experience')?.jobs ?? [];
  const nordicJob = jobs.find((j) => j.lines.some((l) => /checkout|Nordic/i.test(l.text))) ?? jobs[0];
  await assert(nordicJob?.family === 'IT Project Manager', `the IT project manager job keeps its family (${nordicJob?.family})`);
  const drafted = (nordicJob?.lines ?? []).filter((l) => l.state === 'drafted' && l.draft?.mustHave);
  await assert(drafted.length > 0, `${drafted.length} new lines drafted from that family's must-haves`);
  const nordic = page.locator('.paper .pjob').filter({ hasText: 'Nordic' }).first();
  const first = nordic.locator('li.nl').first();
  await qa.click(first.getByRole('button').first(), 'she opens the first new line');
  await qa.expectText(page.getByRole('dialog'), 'IT Project Manager jobs ask:', 'the sheet says which family asked for it');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // ------------------------------------------------------------------------------------------
  // 3. The family correction door knows the new family.
  // ------------------------------------------------------------------------------------------
  const blocks = (await wire('GET', '/job-blocks')).json?.blocks ?? [];
  const baltic = blocks.find((b) => /Baltic/.test(b.employer?.value ?? '')) ?? blocks.find((b) => b.kind === 'job');
  const refused = await wire('POST', `/job-blocks/${baltic.id}/correct`, { key: 'family', value: { familyId: 'product-management', version: 2 } });
  await qa.expectVisible('#qa-wire', 'an unpublished version, verbatim');
  await assert(refused.status === 400, `an unpublished version of the family is refused (${refused.status})`);
  const ok = await wire('POST', `/job-blocks/${baltic.id}/correct`, { key: 'family', value: { familyId: 'product-management', version: 1 } });
  await qa.expectVisible('#qa-wire', 'the correction door answer, verbatim');
  await assert(ok.status === 200 && /Product Manager/.test(ok.text), `product-management v1 is accepted and named "Product Manager" (${ok.status})`);
  const after = (await wire('GET', '/job-blocks')).json?.blocks?.find((b) => b.id === baltic.id);
  await qa.expectVisible('#qa-wire', 'the job read back, verbatim');
  await assert(
    after?.family?.value?.families?.[0]?.familyId === 'product-management',
    `the job reads back in product-management (${JSON.stringify(after?.family?.value)})`,
  );

  // ------------------------------------------------------------------------------------------
  // 4. No session, no door.
  // ------------------------------------------------------------------------------------------
  const anon = await wire('POST', `/job-blocks/${baltic.id}/correct`, { key: 'family', value: { familyId: 'product-management', version: 1 } }, { omit: true });
  await assert(anon.status === 401, `no session -> ${anon.status}`);
} finally {
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
