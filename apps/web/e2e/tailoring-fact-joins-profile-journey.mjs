// #387 (ADR-0018 clause 9) — a fact added while tailoring joins the profile, over the REAL stack
// (fake model only, spends nothing). She tailors a job: a "Yes" to a requirement lands on her
// profile in that requirement's own section — a row in Experience, a chip in Skills — wearing
// "Added while tailoring for <title> at <company>", in the row and in its detail sheet. A "No" is
// no fact and never shows; a Yes corrected to No leaves the profile; a grown ("Changed? Add it")
// fact joins dated. Check mode, opened again afterwards, invents no job for a joined fact.
// profile.spec.ts covers the tag with every API answer mocked; this flow is the only one that runs
// the tailor write, both readers (profile, check mode) and the screen together.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/tailoring-fact-joins-profile-journey.mjs
import { readFileSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const ROLE = 'IT project manager in Paris';
const EMAIL = `tailoring-fact-joins-${Date.now()}@example.com`;
// The fake stack's advert fixture: which requirement lands in which CV section.
const FIXTURE = JSON.parse(readFileSync(new URL('../../api/data/sample-ad-requirements.json', import.meta.url), 'utf8'));
// Requirement ids are unique across the fixture, so a requirement's id names its section.
const SECTION = new Map(FIXTURE.flatMap((ad) => ad.requirements.map((r) => [r.id, r.cvSection ?? 'experience'])));
// Deck cards carry posting hashes, not fixture ids: the companies whose advert asks a Skills requirement.
const SKILLS_COMPANIES = /endava|transunion|synpulse|manulife|hire/i;

const qa = await createSession('tailoring-fact-joins-profile-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null],
  );
const send = (method, path, body) =>
  api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const lower = (s) => s.replace(/^./, (c) => c.toLowerCase());
const asking = async () =>
  ((await page.locator('.tailor .q').textContent()).match(/"([^"]+)"/)?.[1] ?? '').replace(/\.$/, '');
const profileFacts = async () =>
  ((await api('/profile')).body?.domains ?? []).flatMap((d) => d.facts.map((f) => ({ ...f, domain: d.tag })));

try {
  // 1. Her CV is read and checked, she signs in (the tailor door needs an account).
  await qa.goto('/discovery', 'she lands on discovery');
  await send('POST', '/onboarding/discovery/start', { role: ROLE });
  const facts = await qa.factsFromCv();
  if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
  await qa.note(`her CV was read and checked — ${facts} facts on her record`);
  const link = await send('POST', '/auth/request-link', { email: EMAIL });
  if (!link.body?.devLink) throw new Error(`sign-in failed (${link.status}): ${JSON.stringify(link.body)}`);
  await send('POST', '/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });

  // 2. She picks the job with a Skills requirement (Endava: Scrum ceremonies, PM tooling) — reached
  //    by its id, since deck order is not a contract — and opens its tailor screen.
  await qa.goto('/deck', 'her deck of jobs');
  const cards = (await qa.cardsWhenRetrieved({ timeoutMs: 60_000 }))?.cards ?? [];
  await qa.note(`her deck: ${JSON.stringify(cards.map((c) => c.adId))}`);
  const target = cards.find((c) => SKILLS_COMPANIES.test(`${c.company} ${c.title}`)) ?? cards[0];
  if (!target) throw new Error('no job card on her deck');
  await qa.note(`the job she tailors: ${target.title} at ${target.company} (${target.adId})`);
  const want = await send('POST', `/onboarding/cards/${encodeURIComponent(target.adId)}/want`);
  await assert(want.status === 200, `she says she wants this job (${want.status})`);
  await qa.goto('/tailor', 'she opens the tailor screen');
  await qa.expectVisible('.tailor .q', 'the first question about the job');
  const tailor = (await api('/onboarding/tailor')).body;
  const jobName = `${tailor.card.title} at ${tailor.card.company}`;
  const tagCopy = `Added while tailoring for ${jobName}`;
  const sectionOf = (reqId) => SECTION.get(reqId) ?? 'experience';

  // 3. "Yes" to the first question: a true fact.
  const yesText = await asking();
  const yesQ = tailor.questions.find((q) => q.question.includes(yesText));
  await qa.click(page.getByRole('button', { name: 'Yes', exact: true }), `she answers "Yes" to "${yesText}"`);
  await page.waitForTimeout(1400);

  // 4. "No" to the next: no fact.
  const noText = await asking();
  await qa.click(page.getByRole('button', { name: 'No', exact: true }), `she answers "No" to "${noText}"`);
  await page.waitForTimeout(1400);
  await qa.expectVisible(page.locator('.tailor .row.settled').filter({ hasText: noText }), 'the "No" settles on the card');

  // 5. A Skills requirement, answered "Yes" (in-page, same route the button calls).
  const open = (await api('/onboarding/tailor')).body.questions;
  const skillQ = open.find((q) => sectionOf(q.requirementId) === 'skills');
  let skillText = null;
  if (skillQ) {
    skillText = skillQ.question.match(/"([^"]+)"/)?.[1]?.replace(/\.$/, '') ?? null;
    const r = await send('POST', '/onboarding/tailor/answer', { requirementId: skillQ.requirementId, answer: 'Yes' });
    await assert(r.status === 200, `she says "Yes" to the Skills requirement "${skillText}" (${r.status})`);
  } else await qa.note('this job asked no open Skills requirement — the Skills chip is not proven on this run');

  // 6. A correction: Yes, then No — the fact must leave the profile.
  const rest = (await api('/onboarding/tailor')).body.questions.filter((q) => sectionOf(q.requirementId) !== 'skills');
  const flipQ = rest[0] ?? null;
  const flipText = flipQ?.question.match(/"([^"]+)"/)?.[1]?.replace(/\.$/, '') ?? null;
  if (flipQ) {
    await send('POST', '/onboarding/tailor/answer', { requirementId: flipQ.requirementId, answer: 'Yes' });
    const r = await send('POST', '/onboarding/tailor/answer', { requirementId: flipQ.requirementId, answer: 'No' });
    await assert(r.status === 200, `she says "Yes" to "${flipText}", then corrects it to "No" (${r.status})`);
  }

  // 7. The "Changed? Add it" door on the first "No": she has it now, since this year.
  const noReqId = (await api('/onboarding/tailor')).body.doors?.find((d) => true)?.requirementId ?? null;
  const grow = noReqId ? await send('POST', '/onboarding/tailor/answer', { requirementId: noReqId, answer: 'This year' }) : null;
  await assert(grow?.status === 200, `she grows the "No" through "Changed? Add it" — "This year" (${grow?.status})`);

  // 8. The profile.
  const all = await profileFacts();
  const joined = all.filter((f) => f.addedFor);
  await qa.note(`profile facts wearing a job: ${JSON.stringify(joined.map((f) => [f.domain, f.text, f.addedFor]))}`);
  await qa.goto('/profile', 'she opens her profile');
  await qa.scrollThrough('she reads her profile top to bottom');

  const yesRow = page.locator('.frow', { hasText: yesText });
  await qa.expectVisible(yesRow, `AC1: "${yesText}" is on her profile`);
  await qa.expectText(yesRow.locator('.tag.added'), tagCopy, `AC1: it wears "${tagCopy}"`);
  const yesFact = all.find((f) => f.text.startsWith(yesText));
  const yesSection = { experience: 'experience', skills: 'skill', education: 'edu', summary: 'profile' }[sectionOf(yesQ.requirementId)];
  await assert(yesFact?.domain === yesSection, `AC1: in its own section — "${yesFact?.domain}" (the requirement's: "${yesSection}")`);
  await qa.expectVisible(
    page.locator('section.dom').filter({ has: page.locator('h2.dname', { hasText: /Experience/ }) }).locator('.frow', { hasText: yesText }),
    'AC1: the row sits under the Experience heading',
  );

  if (skillText) {
    const chip = page.locator('section.dom').filter({ has: page.locator('h2.dname', { hasText: /Skills/ }) }).locator('.fact', { hasText: skillText.slice(0, 30) });
    await qa.expectVisible(chip.first(), `AC1: the Skills answer "${skillText}" is a chip under Skills`);
    await qa.expectText(chip.first().locator('.tag.added'), tagCopy, 'AC1: the chip wears the job too');
    await assert(all.find((f) => f.text.startsWith(skillText))?.domain === 'skill', 'AC1: the Skills answer sits in the skill section');
  }

  // The detail sheet names the job as well.
  await qa.click(yesRow, 'she opens the joined fact');
  await qa.expectText('.dctx', tagCopy, 'AC1: its detail names the job it was added while tailoring for');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // A "No" never shows; a Yes corrected to No has left.
  // The "No" was grown below, so its words return only as the dated fact — never undated.
  const visible = await page.locator('body').innerText();
  const undated = visible.split(/\r?\n/).filter((l) => l.includes(noText) && !l.includes('(since'));
  await assert(!all.some((f) => f.text === `${noText}.`) && undated.length === 0, `a "No" ("${noText}") never shows on her profile (undated lines: ${JSON.stringify(undated)})`);
  if (flipText) await assert(!all.some((f) => f.text.includes(flipText)) && !visible.includes(flipText), `the corrected answer ("${flipText}", Yes then No) is not on her profile`);
  const grown = all.find((f) => f.text.startsWith(noText) && /\(since \d{4}\)/.test(f.text));
  await assert(grown?.addedFor === jobName, `the grown fact joins dated and wears the job: ${JSON.stringify(grown)}`);
  if (grown) await qa.expectText(page.locator('.frow, .fact', { hasText: '(since' }).first().locator('.tag.added'), tagCopy, 'the grown fact wears the job on screen');
  await assert(!all.some((f) => /^Not applicable/.test(f.text)), 'no "Not applicable" line reaches the profile');

  // 9. Check mode, opened again: a joined fact is no job of its own.
  const review = await api('/review');
  const jobs = (review.body?.sections ?? []).flatMap((s) => s.jobs ?? []);
  await qa.note(`check mode jobs: ${JSON.stringify(jobs.map((j) => [j.title, j.employer, j.lines?.length]))}`);
  await assert(!jobs.some((j) => j.title === 'profile' || j.id === 'profile'), 'check mode invents no "profile" job for a joined fact');
  await qa.goto('/profile/check', 'she opens check mode again');
  // Check mode is a stepper: walk it as she would, and look at every step for a job named "profile".
  const steps = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(500);
    // A job step is titled by its employer, with "<title> · <dates>" under it (.bigsub).
    const heads = (await page.locator('h1, h2, .bigsub').allTextContents()).map((h) => h.trim()).filter(Boolean);
    steps.push(heads.join(' | '));
    const phantom = page.locator('.bigsub').filter({ hasText: /^\s*profile\s*$/i });
    if ((await phantom.count()) > 0) {
      await qa.expectVisible(phantom.first(), `check mode step ${i + 1} shows a job headed "profile" (${heads.join(' | ')})`);
      await qa.scrollThrough('she reads that step');
      break;
    }
    const next = page.getByRole('button', { name: /^Next/ });
    if ((await next.count()) === 0) break;
    await qa.click(next.first(), `Next (from "${heads.join(' | ')}")`);
  }
  await qa.note(`check mode steps she walked: ${JSON.stringify(steps)}`);
  await assert(!steps.some((h) => h.split(' | ').some((x) => /^profile$/i.test(x))), 'no check-mode step is a job headed "profile"');
} catch (err) {
  await qa.note(`RUN ERROR: ${err?.stack ?? err}`);
  await assert(false, `the journey ran to the end (${err?.message ?? err})`);
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
