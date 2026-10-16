// #393 — no skills group is ever named after its own section. Walked over the REAL stack (fake
// model only): she pastes her CV, opens check mode's Skills screen and her profile, and nowhere sees
// a group called "Skills"; the two group doors (rename, move) refuse that name over the wire and on
// the screen, while an ordinary rename still goes through.
//
// What the fake stack cannot show: tools moved in from a job (its miner answers one recorded CV
// with no tool line under a job) and the neutral label for skills the model leaves unnamed (the fake
// always names them "Software"). cvReviewRun.test.ts "#383 tools move to Skills" proves the first
// over HTTP; e2e/check-mode.spec.ts (#382, #383) and e2e/profile.spec.ts show both screens printing
// a named group for a moved tool.
//
//   PORT=34201 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34201 npx next build && npx next start -p 34200
//   BASE_URL=http://127.0.0.1:34200 node apps/web/e2e/qa-393-skills-groups-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34200';
const WIDTH = Number(process.env.QA_WIDTH ?? 1280);
const RUN = Date.now().toString(36);
const SECTION = 'skills';
const CV_TEXT = [
  'Jane Doe',
  `+33 6 00 00 00 00 | jane.393.${RUN}@example.com`,
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated releases for four agile squads.',
  '',
  'SKILLS',
  'Jira, MS Project, Confluence, SQL basics, Power BI',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

const qa = await createSession(`qa-393-skills-groups-${WIDTH}`, { baseURL: BASE, viewport: { width: WIDTH, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const json = (path, init, credentials = 'same-origin') =>
  page.evaluate(
    async ([p, i, c]) => {
      const res = await fetch(`/api${p}`, { credentials: c, ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null, credentials],
  );
const put = (path, body, credentials) =>
  json(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, credentials);
const skillSection = async () => (await json('/review')).body.sections.find((s) => s.tag === 'skill');
const isSectionName = (n) => n.trim().toLowerCase() === SECTION;

const h1 = page.locator('main h1');
const primary = page.locator('.foot .primary');
const headings = page.locator('main .groups .grp .gh');
async function walkTo(re) {
  await h1.waitFor();
  for (let i = 0; i < 14; i += 1) {
    if (re.test((await h1.textContent()) ?? '')) return true;
    if ((await primary.isDisabled()) || !/^Next:/.test((await primary.textContent()) ?? '')) return false;
    await primary.click();
    await page.waitForTimeout(400);
  }
  return false;
}

try {
  // 1. Her CV in, the job she is going for. The QA stack holds the review run from before the paste
  // (POST /qa/stack reviewHold), so the Skills screen can be seen before the model names any group.
  await qa.goto('/', 'the front door');
  const hold = (on) => json('/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewHold: on }) });
  await assert((await hold(true)).status === 200, 'the QA stack holds the review run');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', 'IT project manager', 'the job she is going for');
  await qa.fill('#search-area', 'Singapore', 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);

  // 1b. While the review is held, check mode is the reading screen (owner, 2026-10-16): no Skills
  // screen exists yet, so no group can be seen waiting for its name.
  await qa.goto('/profile/check', 'check mode, while the review is still running');
  await qa.expectText('.check .reading h1', 'Reading your CV', 'the review is running: the reading screen, not the walk');
  await assert((await page.locator('main .groups').count()) === 0, 'no Skills screen to read before the groups are named');
  await assert((await hold(false)).status === 200, 'the review run is released');

  // The review names the skills the CV left ungrouped; wait for it to land (fake: milliseconds).
  let groups = [];
  for (let i = 0; i < 40; i += 1) {
    groups = (await skillSection())?.groups ?? [];
    if (groups.some((g) => g.name === 'Software')) break;
    await page.waitForTimeout(500);
  }
  await assert(groups.length > 0, `the wire's Skills groups: ${JSON.stringify(groups.map((g) => g.name))}`);
  await assert(!groups.some((g) => isSectionName(g.name)), 'no group on the wire is named after the section');

  // The job screens hold Next until each suggestion is answered — not what this walk is about, so
  // they are answered through the screen's own doors (No thanks / Keep it) before she walks.
  const lines = (await json('/review')).body.sections.flatMap((s) => ('jobs' in s ? s.jobs.flatMap((j) => j.lines) : s.lines));
  for (const l of lines.filter((x) => x.state === 'drafted')) await put(`/review/drafts/${encodeURIComponent(l.id)}/dismissed`, { dismissed: true });
  for (const l of lines.filter((x) => x.state === 'removal-suggested')) await put(`/cv/lines/${encodeURIComponent(l.id)}`, { state: 'ticked' });

  // 2. Check mode's Skills screen: the group headings she reads.
  await qa.goto('/profile/check', 'check mode');
  await assert(await walkTo(/^Skills/), 'walked to the Skills screen');
  await qa.scrollThrough('reads the Skills screen');
  await qa.expectVisible(headings.first(), 'the Skills screen shows its group headings');
  const shown = await headings.allTextContents();
  await assert(shown.length > 0 && !shown.some(isSectionName), `no heading reads "Skills" — headings: ${JSON.stringify(shown)}`);
  await qa.expectText(headings.filter({ hasText: 'Software' }).first(), 'Software', 'her unlabelled skills sit under a real group name');

  // 3. On the screen: she tries to rename the group "Skills" — refused, the name stays.
  await qa.click(headings.filter({ hasText: 'Software' }).first(), 'she taps the group name to rename it');
  await qa.fill('main input.gname', 'Skills', 'she types "Skills"');
  await qa.press('main input.gname', 'Enter', 'Enter keeps the change');
  await page.waitForTimeout(800);
  await qa.expectVisible(page.getByText("Couldn't save that — try again."), 'the screen says it could not save');
  await assert(!(await headings.allTextContents()).some(isSectionName), 'the heading still is not "Skills"');

  // An ordinary rename goes through.
  await qa.click(headings.filter({ hasText: 'Software' }).first(), 'she taps the group name again');
  await qa.fill('main input.gname', 'Delivery tools', 'she types "Delivery tools"');
  await qa.press('main input.gname', 'Enter', 'Enter keeps the change');
  await page.waitForTimeout(800);
  await qa.expectText(headings.filter({ hasText: 'Delivery tools' }).first(), 'Delivery tools', 'the group now reads "Delivery tools"');

  // 4. The doors over the wire.
  const skill = await skillSection();
  const lineId = skill.lines[0].id;
  const r1 = await put('/cv/skills/groups/Delivery%20tools', { name: 'Skills' });
  await assert(r1.status === 400, `rename to "Skills" → ${r1.status} (want 400)`);
  const r2 = await put('/cv/skills/groups/Delivery%20tools', { name: '  SKILLS ' });
  await assert(r2.status === 400, `rename to "  SKILLS " → ${r2.status} (want 400)`);
  const r3 = await put(`/cv/lines/${encodeURIComponent(lineId)}/group`, { group: ' skills ' });
  await assert(r3.status === 400, `move a skill to " skills " → ${r3.status} (want 400)`);
  // (An invalid name is refused 400 before the session is read — body validation runs first.)
  const r4 = await put('/cv/skills/groups/Delivery%20tools', { name: 'Anything' }, 'omit');
  await assert(r4.status === 401, `rename with no session → ${r4.status} (want 401)`);
  const r5 = await put(`/cv/lines/${encodeURIComponent(lineId)}/group`, { group: 'Tools and platforms' });
  await assert(r5.status === 200, `an ordinary move to "Tools and platforms" → ${r5.status} (want 200)`);
  const after = (await skillSection()).groups.map((g) => g.name);
  await assert(after.includes('Tools and platforms') && !after.some(isSectionName), `groups after the doors: ${JSON.stringify(after)}`);

  // 5. Her profile, after the finish: the same groups, none named "Skills".
  await qa.completeReview();
  await qa.goto('/profile', 'her profile');
  const names = page.locator('.sgrp .sgname');
  // On a phone the facts live in a sheet at the bottom edge: a tap on its grabber opens it.
  if (WIDTH < 600) await qa.click('.pfgrab', 'she opens her facts sheet');
  await names.first().waitFor();
  await qa.scrollThrough('reads her profile');
  await qa.expectVisible(names.first(), 'the profile shows the Skills group headings');
  const onProfile = await names.allTextContents();
  await assert(onProfile.length > 0 && !onProfile.some(isSectionName), `no profile group reads "Skills" — ${JSON.stringify(onProfile)}`);
  await assert(JSON.stringify([...onProfile].sort()) === JSON.stringify([...after].sort()), `the profile's groups match check mode's (${JSON.stringify(after)})`);
} catch (err) {
  qa.note(`journey aborted: ${err?.stack ?? err}`);
  await assert(false, `journey aborted: ${err?.message ?? err}`);
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
