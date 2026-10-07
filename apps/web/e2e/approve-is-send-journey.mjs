// #313 "Approving is sending" — the live journey, human-paced, over the REAL fake-model QA stack
// (qa-main: stage-aware fake model, StandInDocumentMaker, DevMailer — no route mocks on the path
// under test): reach the Tailor ending -> the draft is shown -> ONE press -> the narrated wait ->
// "Done — your CV is made and the email is on its way." with his own address named.
//
// Then over the wire, with his real cookie: the job record says sent / 2 pages / his address; a
// press naming a draft he never saw is refused (409 not_approved); a signed-out press is refused.
//
// The stand-in prints instantly, so on this stack the server's "sending" step and the terminal
// snapshot reach the screen together. Step 5 therefore holds the progress stream (page.route, the
// ONLY interception in this file) and serves the server's own two mid-run snapshots, to prove the
// screen renders "Emailing it to you…" when the server says so. The real ~33s cold start is a
// release-gate concern (scripts/print-gate.mjs, staging), not this stack's.
//
//   PORT=34313 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34313 npx next build && npx next start -p 34312
//   BASE_URL=http://127.0.0.1:34312 node apps/web/e2e/approve-is-send-journey.mjs
//   (the DevMailer line "[dev-mailer] tailored CV for <email>" lands in the API's stdout)

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'IT project manager in Paris';
const EMAIL = `approve-send-${Date.now()}@example.com`;

const S1 = 'Approve and email me this CV';
const S2 = 'One press: we turn this draft into a PDF and email it to you. You send it on yourself.';
const S3 = 'Making your PDF…';
const S4 = 'The first press can take about half a minute while the machine warms up. Stay here.';
const S5 = 'Emailing it to you…';
const S6 = 'Done — your CV is made and the email is on its way.';

const qa = await createSession('approve-is-send-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, i ?? undefined);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init ?? null],
  );
const postJson = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function readThrough(note) {
  await qa.note(note);
  await page.evaluate(async () => {
    const el = document.querySelector('.live-wrap') ?? document.scrollingElement;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
  });
  await page.waitForTimeout(900);
}

// Record every text the send block shows, with a timestamp, so a narration step that flashes by
// faster than a screenshot is still on the record.
async function watchSendBlock() {
  await page.evaluate(() => {
    window.__sendTimeline = [];
    let last = '';
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector('.draft-send');
      const text = el ? el.innerText.replace(/\s+/g, ' ').trim() : '(none)';
      if (text !== last) window.__sendTimeline.push({ ms: Math.round(performance.now() - t0), text });
      last = text;
    };
    new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, characterData: true });
    tick();
  });
}

// ---------------------------------------------------------------------------------------------
// 0. Seed: discovery + his CV's facts + real magic-link sign-in (the document goes to HIS address).
//    #339: the floor answers that used to give the draft its facts are gone; a read, reviewed CV
//    is where his facts come from now.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await postJson('/api/onboarding/discovery/start', { role: ROLE });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`his CV gave the session no facts (${facts})`);
await qa.note(`his CV was read and reviewed — ${facts} facts on his record`);
const link = await postJson('/api/auth/request-link', { email: EMAIL });
if (!link.body?.devLink) throw new Error(`sign-in failed (${link.status}): ${JSON.stringify(link.body)}`);
await postJson('/api/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });
await qa.note(`signed in as ${EMAIL}`);

// ---------------------------------------------------------------------------------------------
// 1. Deck -> want -> Tailor -> "I'm done" -> the draft.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'the deck card renders');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — I want this one');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), "I'm done — use this CV");
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the tailored CV draft is shown');
await readThrough('read down through the draft to the send block');

// ---------------------------------------------------------------------------------------------
// 2. AC "one press, not two": exactly one send control, explained.
// ---------------------------------------------------------------------------------------------
const approve = page.getByRole('button', { name: S1 });
await qa.expectVisible(approve, `the one press: "${S1}"`);
await qa.expectText('.draft-send', S2, 'the press says what it does, in one line');
// The label must be readable: text colour and fill must differ (an undefined colour token falls back
// to the inherited light ink — light text on a light fill, a blank-looking button).
const look = await approve.evaluate((e) => {
  const s = getComputedStyle(e);
  return { color: s.color, background: s.backgroundColor };
});
// WCAG contrast ratio of label vs fill — AA for 13px text is 4.5.
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const [hi, lo] = [lum(look.color), lum(look.background)].sort((a, b) => b - a);
const ratio = (hi + 0.05) / (lo + 0.05);
await assert(ratio >= 4.5, `the press's label is readable: text ${look.color} on ${look.background}, contrast ${ratio.toFixed(2)}:1 (AA needs 4.5)`);
// #313 fix: "Apply with this CV" — a second button with no decision behind it — is gone from the ending.
const applyCount = await page.getByRole('button', { name: /apply with this cv/i }).count();
await assert(applyCount === 0, `no "Apply with this CV" control anywhere on the ending (found ${applyCount})`);
await assert(
  !(await page.locator('body').innerText()).includes('Nothing goes out until you press send'),
  'no dead-end "Nothing goes out until you press send" holding text',
);
await qa.expectVisible(page.getByRole('button', { name: 'Save it and come back later' }), 'the ending keeps "Save it and come back later"');
const sendish = await page.getByRole('button', { name: /approve|send|email|export|pdf|download/i }).count();
await assert(sendish === 1, `exactly one approve/send/email control on the draft screen (found ${sendish})`);

const draftBefore = await api('/api/onboarding/tailor/draft');
const draftedAt = draftBefore.body?.draftedAt;
await qa.note(`draft on screen: draftedAt=${draftedAt}`);

// ---------------------------------------------------------------------------------------------
// 3. Press it. One press, no confirm dialog, narrated wait, confirmation naming his address.
// ---------------------------------------------------------------------------------------------
let dialogs = 0;
page.on('dialog', (d) => {
  dialogs++;
  void d.dismiss();
});
await watchSendBlock();
const approveResponse = page.waitForResponse((r) => r.url().includes('/api/onboarding/tailor/approve'));
await qa.click(approve, 'press "Approve and email me this CV" — once');
const approveRes = await approveResponse;
const jobId = (await approveRes.json().catch(() => ({}))).jobId;
await qa.note(`POST /approve -> ${approveRes.status()} jobId=${jobId}`);
await assert(approveRes.status() === 202, `the press is accepted and handed a job to watch (${approveRes.status()})`);

await qa.expectText('.draft-send', S6, 'the screen confirms: the document is made and the mail is away');
await qa.expectText('.draft-send', `Sent to ${EMAIL}.`, 'the confirmation names his own address');
await assert(dialogs === 0, `no second confirm — no dialog was raised (dialogs: ${dialogs})`);
const buttonsAfter = await page.locator('.draft-send button').count();
await assert(buttonsAfter === 0, `nothing else to press once sent (buttons in the send block: ${buttonsAfter})`);

const timeline = await page.evaluate(() => window.__sendTimeline);
await qa.note(`send-block timeline: ${JSON.stringify(timeline)}`);
await assert(
  timeline.some((t) => t.text.includes(S3)),
  `"${S3}" was on screen during the wait (never silence)`,
);

// ---------------------------------------------------------------------------------------------
// 4. Over the wire: the job record, and the server-side gates.
// ---------------------------------------------------------------------------------------------
const job = await api(`/api/jobs/${jobId}`);
const exported = job.body?.progress?.tailorExport ?? {};
await qa.note(`job record: status=${job.body?.status} tailorExport=${JSON.stringify(exported)}`);
await assert(
  job.body?.status === 'completed' && exported.step === 'sent' && exported.pages === 2 && exported.email === EMAIL,
  'job record: completed, step "sent", 2 pages, his address',
);

const stale = await postJson('/api/onboarding/tailor/approve', { draftedAt: '2020-01-01T00:00:00.000Z' });
await assert(
  stale.status === 409 && stale.body?.error?.code === 'not_approved',
  `a press naming a draft he never saw is refused: ${stale.status} ${stale.body?.error?.code}`,
);
const empty = await postJson('/api/onboarding/tailor/approve', {});
await assert(empty.status === 400, `a press with no draft named is refused: ${empty.status}`);

// ---------------------------------------------------------------------------------------------
// 5. The "Emailing it to you…" step renders when the server narrates it. The stand-in is instant,
//    so hold the stream and serve the server's own mid-run snapshot shapes (printing, then sending).
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload — a fresh screen for the narration check');
await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), "I'm done — use this CV (the ending is screen state)");
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await page.route('**/api/jobs/*/events', async (route) => {
  const snap = (step) =>
    `data: ${JSON.stringify({ id: 'held', status: 'running', progress: { tailorExport: { step } } })}\n\n`;
  await new Promise((r) => setTimeout(r, 6000));
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    body: snap('printing') + snap('sending'),
  });
});
await readThrough('scroll back down to the send block');
await qa.click(page.getByRole('button', { name: S1 }), 'press again (the stream is held to watch each step)');
await qa.expectText('.draft-send', S3, `narration step 1: "${S3}"`);
await qa.expectText('.draft-send', S4, 'the cold-start line tells him to stay');
await page.getByText(S5).waitFor({ timeout: 15_000 }).catch(() => {});
await qa.expectText('.draft-send', S5, `narration step 2: "${S5}"`);
await page.unroute('**/api/jobs/*/events');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
