// #448 — each person keeps their own apply link for a pasted job, never another person's.
//
// Three people, three separate browsers, ONE advert text. Driven human-paced over the fake-model QA
// stack (qa-main), the stack the bug was first seen on during the #442 gate.
//
// What it proves, in the order the people meet it:
//   1  A pastes the advert with link A; B pastes the SAME text with link B. Same job (one reading),
//      and each one's job screen shows only their own link — A's screen re-read after B's paste.
//   2  C pastes the same text with NO link: C sees "No application link yet — add the application
//      link", never A's or B's. C adds a link of their own; A's and B's are unchanged. Before C has
//      pasted, C's write to that job is refused (404) — the control writes only to your own job.
//   3  A pastes again with a new link: it replaces A's old one. A re-paste with no link keeps it.
//      A asking to add a link while already having one gets 409 with A's own link, never anyone else's.
//   4  (only when MAIL_LOG names the file a mail-recording wrapper writes) A and B each approve their
//      draft; each application email opens "Apply here: <their own link>".
//
//   PORT=34481 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js   (or a MAIL_LOG wrapper around it)
//   cd apps/web && API_URL=http://127.0.0.1:34481 npx next build && npx next start -p 34480
//   BASE_URL=http://127.0.0.1:34480 [MAIL_LOG=<file>] node apps/web/e2e/apply-link-per-person-journey.mjs
//
// Three sign-ins: mind auth's 5-per-15-minutes-per-IP limiter (routes/auth.ts) on back-to-back runs.

import { readFileSync, existsSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_LOG = process.env.MAIL_LOG ?? null;
const ROLE = 'IT project manager in Brussels';
const RUN = Date.now();
const LINK_A = `https://www.linkedin.example/jobs/view/${RUN}/?trk=person-a`;
const LINK_A2 = `https://careers.example.com/jobs/${RUN}/apply?ref=person-a-second`;
const LINK_B = `https://www.linkedin.example/jobs/view/${RUN}/?trk=person-b`;
const LINK_C = `https://careers.example.com/jobs/${RUN}/apply?ref=person-c`;
const EMPTY = 'No application link yet — add the application link';

// No link anywhere in the text, so the only link each person gives is the one they type.
const ADVERT = `Senior IT Project Manager — Ostrava Digital ${RUN}
Brussels, Belgium · Hybrid

Ostrava Digital is looking for a Senior IT Project Manager to lead the delivery of our CRM rollout.

What you will do
- Own the end-to-end delivery of the programme, from the business case through to go-live.
- Coordinate business and technical stakeholders and report progress to the steering committee.
- Identify, track and mitigate risks, issues and dependencies.

What we are looking for
- At least six years managing IT projects.
- Excellent stakeholder communication at executive level.`;

const people = {};
let failures = 0;

async function person(name) {
  const qa = await createSession(`apply-link-per-person-${name}`, { baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const { page } = qa;
  const api = (path, init) =>
    page.evaluate(
      async ([p, i]) => {
        const r = await fetch(p, i ?? undefined);
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [path, init ?? null],
    );
  const postJson = (path, body, method = 'POST') =>
    api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
  // Lower-case: the server stores (and mails) the address lower-cased, and MAIL_LOG is matched on it.
  const email = `apply-link-${name.toLowerCase()}-${RUN}@example.com`;

  await qa.goto('/discovery', `person ${name}: land on discovery — their own anonymous session`);
  await postJson('/api/onboarding/discovery/start', { role: ROLE });
  const facts = await qa.factsFromCv();
  const link = await postJson('/api/auth/request-link', { email });
  if (!link.body?.devLink) throw new Error(`person ${name}: sign-in failed (${link.status}) — the limiter? ${JSON.stringify(link.body)}`);
  await postJson('/api/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });
  await qa.note(`person ${name}: signed in as ${email}, ${facts} facts from their CV`);
  return (people[name] = { name, qa, page, api, postJson, assert, email, adId: null });
}

/** Paste the advert at the paste door, typing `applyLink` (or clearing the field when null). */
async function paste(p, applyLink, note) {
  const { qa, page } = p;
  await qa.goto('/paste', `person ${p.name}: the paste door`);
  await qa.fill(page.locator('#advert'), ADVERT, `person ${p.name}: paste the job text (no link in it)`);
  await qa.fill(page.locator('#applylink'), applyLink ?? '', applyLink ? `person ${p.name}: type their own link ${applyLink}` : `person ${p.name}: leave the link empty`);
  await qa.click(page.getByRole('button', { name: 'Read it' }), `person ${p.name}: press 'Read it' — ${note}`);
  await page.waitForURL(/\/job\//, { timeout: 180_000 }).catch(() => {});
  await page.locator('.onejob .jobcard').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await qa.expectVisible('.onejob .jobcard', `person ${p.name}: the job's own screen`);
  await qa.scrollThrough(`person ${p.name}: read the job down to the apply row`);
  p.adId = decodeURIComponent(new URL(page.url()).pathname.split('/job/')[1] ?? '');
  return p.adId;
}

/** Open the job's own screen fresh and check what the apply row shows. */
async function expectLink(p, want, note) {
  const { qa, page } = p;
  await qa.goto(`/job/${encodeURIComponent(p.adId)}`, `person ${p.name}: open the job's own screen again`);
  await page.locator('.onejob .applyrow').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  if (want) {
    const href = await page.locator('.onejob .applylink').getAttribute('href', { timeout: 5_000 }).catch(() => null);
    await qa.expectVisible('.onejob .applylink', `person ${p.name}: "Apply for this job" is on their screen`);
    await p.assert(href === want, `${note} (link on screen: ${href})`);
  } else {
    await qa.expectText('.onejob .applyrow', EMPTY, note);
    await p.assert((await page.locator('.onejob .applylink').count()) === 0, `person ${p.name}: no "Apply for this job" link at all`);
  }
}

try {
  // 1. Two people, the same text, two links.
  const A = await person('A');
  await paste(A, LINK_A, 'with their own link');
  await expectLink(A, LINK_A, 'person A sees their own link');

  const B = await person('B');
  await paste(B, LINK_B, 'the SAME text, with a different link');
  await B.assert(B.adId === A.adId, `person B landed on the same job as person A (${B.adId})`);
  await expectLink(B, LINK_B, "person B sees their own link — never person A's");
  await expectLink(A, LINK_A, "person A's screen, re-read after B's paste: still A's own link");

  // 2. A third person gives no link: nobody's link is lent to them; they add their own.
  const C = await person('C');
  const early = await C.postJson(`/api/onboarding/jobs/${encodeURIComponent(A.adId)}/application-link`, { applicationUrl: LINK_C }, 'PUT');
  await C.assert(early.status === 404, `before pasting it, person C cannot write a link onto that job (HTTP ${early.status})`);
  await paste(C, null, 'the same text, with NO link');
  await C.assert(C.adId === A.adId, `person C landed on the same job (${C.adId})`);
  await expectLink(C, null, `person C sees "${EMPTY}" — not A's or B's link`);
  await C.qa.click(C.page.getByRole('button', { name: EMPTY }), 'person C: press "add the application link"');
  await C.qa.fill(C.page.getByLabel('The link to apply for this job'), LINK_C, 'person C: type their own link');
  await C.qa.click(C.page.getByRole('button', { name: 'Save the link' }), 'person C: save it');
  await C.page.locator('.onejob .applylink').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await C.qa.expectVisible('.onejob .applylink', 'person C: the row turns into "Apply for this job"');
  await expectLink(C, LINK_C, "person C's own link, after a reload");
  await expectLink(A, LINK_A, "person A's link is untouched by C's add");
  await expectLink(B, LINK_B, "person B's link is untouched by C's add");

  // 3. The same person pastes again: their latest link wins; a link-less re-paste keeps it.
  await paste(A, LINK_A2, 'the same job again, with a NEW link');
  await expectLink(A, LINK_A2, "person A's new link replaced their old one");
  await paste(A, null, 'the same job again, with no link this time');
  await expectLink(A, LINK_A2, 'a re-paste with no link keeps the link person A already gave');
  await expectLink(B, LINK_B, "person B's link is untouched by A's re-pastes");
  const again = await A.postJson(`/api/onboarding/jobs/${encodeURIComponent(A.adId)}/application-link`, { applicationUrl: LINK_C }, 'PUT');
  await A.assert(again.status === 409 && again.body?.applicationUrl === LINK_A2,
    `person A, already holding a link, is told so with THEIR link (HTTP ${again.status}, ${again.body?.applicationUrl})`);

  // 4. The application emails, each with its own link.
  for (const [p, want] of [[A, LINK_A2], [B, LINK_B]]) {
    const { qa, page } = p;
    await qa.goto(`/job/${encodeURIComponent(p.adId)}`, `person ${p.name}: back to the job`);
    await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), `person ${p.name}: Write the tailored CV`);
    await page.waitForURL('**/tailor', { timeout: 15_000 }).catch(() => {});
    if ((await page.locator('.tailor .ask .q').count()) > 0) {
      await qa.click(page.locator('.tailor .opts .opt').first(), `person ${p.name}: a profile question first — answer it once`);
      await page.waitForTimeout(1400);
    }
    await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
    await qa.expectVisible('.draft-frame', `person ${p.name}: the tailored draft`);
    const pressed = page.waitForResponse((r) => r.url().includes('/api/onboarding/tailor/approve'));
    await qa.click(page.getByRole('button', { name: 'Approve and email me this CV' }), `person ${p.name}: approve and email`);
    await pressed;
    await page.getByText('Done — your CV is made and the email is on its way.').waitFor({ timeout: 60_000 }).catch(() => {});
    await qa.expectText('.draft-send', 'Done', `person ${p.name}: Done — the email is on its way`);
    if (!MAIL_LOG) { await qa.note('MAIL_LOG not set — the email body is not readable on this stack; skipped'); continue; }
    await page.waitForTimeout(1500);
    const mail = existsSync(MAIL_LOG)
      ? readFileSync(MAIL_LOG, 'utf8').split('=====MAIL to ').slice(1).filter((m) => m.split(' |')[0] === p.email).pop()
      : undefined;
    const body = mail?.split('\n').slice(1).join('\n').split('=====END')[0] ?? '';
    const applyLine = body.split('\n').find((l) => l.startsWith('Apply here:')) ?? '(no apply line)';
    await qa.note(`person ${p.name}'s email apply line: ${applyLine}`);
    await p.assert(applyLine === `Apply here: ${want}`, `person ${p.name}'s application email carries their own link (${applyLine})`);
    const others = [LINK_A, LINK_A2, LINK_B, LINK_C].filter((l) => l !== want);
    await p.assert(others.every((l) => !body.includes(l)), `person ${p.name}'s email carries nobody else's link`);
  }
} finally {
  for (const p of Object.values(people)) if (!(await p.qa.finish())) failures += 1;
}
process.exit(failures === 0 ? 0 : 1);
