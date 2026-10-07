// #19 the reveal + the job card (screen 2a) — a human-paced, screenshot-documented drive of the
// real onboarding journey over the live API, left in the repo as a re-runnable CI asset (run with
// `node`, never the Playwright MCP). Companion to the assertion-only deck.spec.ts: this one scrolls
// like a reader and captures highlighted-evidence screenshots + a self-contained HTML report.
//
// It also documents the current discovery -> /deck reachability boundary: completing the current
// question set shows the brief handoff and then navigates to the reveal.
//
// Run:  BASE_URL=http://127.0.0.1:3020 node e2e/onboarding-reveal-card.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3020";
const ROLE = "IT project manager in Paris";

const qa = await createSession("onboarding-reveal-card", { baseURL: BASE_URL });
const { page } = qa;

// 1) Bootstrap the anonymous session (ensureSession runs client-side on /discovery mount), then
//    answer today's complete question set over the API in-page so the Secure loopback cookie rides
//    along. This journey focuses on the reveal/card; the sibling wall journey drives each control.
await qa.goto("/discovery", "bootstrap the anonymous session on the discovery screen");
const seed = await page.evaluate(async (role) => {
  const post = async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, state: await response.json() };
  };
  const codes = [];
  let current = await post("/api/onboarding/discovery/start", { role });
  codes.push(current.status);
  // #339: after question 1 these are the eligibility questions only (work rights, then languages),
  // each answered with its first real option — a put-off one would stay open and never reach "deck".
  let answered = 0;
  while (current.state.stage !== "deck" && answered < 6) {
    const question = current.state.questions?.[0];
    if (!question) break;
    const body = question.multiSelect
      ? { itemId: question.itemId, answers: [question.options[0]] }
      : { itemId: question.itemId, answer: question.options[0] };
    current = await post("/api/onboarding/discovery/answer", body);
    codes.push(current.status);
    answered += 1;
  }
  return { codes, answered, stage: current.state.stage };
}, ROLE);
await qa.note(`answered ${seed.answered} discovery questions over the real API — stage=${seed.stage}; POST status codes: ${seed.codes.join(", ")}`);
// #339: those answers are eligibility, never facts, and the card's "Where you fit" needs facts to
// list — a read, reviewed CV gives them now (the floor answers that used to are gone).
const facts = await qa.factsFromCv();
await qa.note(`her CV was read and reviewed — ${facts} facts for the card to score against`);

// 2) The reachability boundary: reload discovery complete and let its current handoff navigate.
await qa.goto("/discovery", "reload discovery with the current question set answered");
await page.waitForURL("**/deck", { timeout: 5000 });
await qa.note(`discovery completed at ${seed.answered} answers and navigated to ${new URL(page.url()).pathname}`);

// 3) The reveal (AC1): one line, one button, nothing behind it.
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), "the reveal shows one headline: '… just matched you'");
await qa.expectVisible(page.getByRole("button", { name: "See them" }), "one button: 'See them'");
const behind = await page.getByRole("heading", { name: "Where you fit" }).count();
await qa.note(`AC1 nothing-behind-the-curtain: deck card headings present before 'See them' = ${behind} (expected 0)`);

// This journey is about the card rather than the sibling's account-wall UX, so claim the anonymous
// session through the checked-in dev-mailer route before revealing it.
const signedIn = await page.evaluate(async () => {
  const email = `reveal-card-e2e-${Date.now()}@example.com`;
  const request = await fetch('/api/auth/request-link', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const result = await request.json().catch(() => ({}));
  if (!result.devLink) return { ok: false, status: request.status };
  const token = new URL('http://x' + result.devLink).searchParams.get('token');
  const verify = await fetch('/api/auth/verify', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
  });
  return { ok: verify.ok, status: verify.status };
});
await qa.expectText('body', signedIn.ok ? '' : ' -IMPOSSIBLE-', `the reveal session is signed in before opening the card (${JSON.stringify(signedIn)})`);
await qa.goto('/deck', 'reload the reveal as the signed-in visitor');
await qa.expectVisible(page.getByRole("button", { name: "See them" }), "the signed-in reveal is ready");

// 4) Open the deck (AC2 + AC4): it opens straight onto the best (top) card. Read it like a human.
await qa.click(page.getByRole("button", { name: "See them" }), "press 'See them' — the deck opens on the best match");
await qa.scrollThrough("read the card top to bottom");
await qa.expectVisible(page.getByRole("img", { name: /% match/ }), "the match % ring — the one number on the card");
await qa.expectVisible(page.locator(".jobcard h2").first(), "card leads with the job title");
await qa.expectVisible(page.locator(".bubble"), "the highlight bubble sits under the score (strongest hit + biggest open)");
await qa.expectVisible(page.getByRole("heading", { name: "Where you fit" }), "'Where you fit' — my confirmed facts");
await qa.expectVisible(page.getByRole("heading", { name: "Where you don't — yet" }), "'Where you don't — yet' — the ad's open asks");
// #311 (#287 c4): the recorded "no" is named only on a posting that asks for it in the denial's
// own words — the top card may honestly show nothing. Note what this card does, assert nothing.
const deniedHeadings = await page.getByRole("heading", { name: "You told me you don't have this" }).count();
qa.note(`#311 denial naming: 'You told me you don't have this' present on the top card = ${deniedHeadings} (named only where the posting asks)`);

// 5) The ad is folded shut, last (AC4).
await qa.expectVisible(page.getByText("Read the ad in full"), "the ad is present, folded shut, last");
const adOpen = await page.locator("details.ad").evaluate((el) => el.open);
qa.note(`AC4 ad folded: <details.ad> open attribute = ${adOpen} (expected false)`);

// 6) The marks (AC5): only gold check / grey ? / dim dot — never a cross, in any glyph form.
const crosses = await page.evaluate(() => {
  const body = document.body.innerText;
  return { "✗": (body.match(/✗/g) || []).length, "✕": (body.match(/✕/g) || []).length, "×": (body.match(/×/g) || []).length };
});
qa.note(`AC5 never-a-cross: cross-glyph counts in the rendered card = ${JSON.stringify(crosses)} (all expected 0)`);
await qa.expectVisible(page.locator(".row.fit .mk").first(), "a gold ✓ marks a fit row");
// #311: the settled · row exists only when THIS card names the denial (see the heading note above).
if (deniedHeadings > 0) {
  await qa.expectVisible(page.locator(".row.settled .mk").first(), "a dim · marks a named denial's row");
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
