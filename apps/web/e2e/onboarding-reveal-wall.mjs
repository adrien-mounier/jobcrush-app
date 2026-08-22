// #25 (discovery -> /deck reveal) + #22 (the account wall at the reveal) — a human-paced,
// screenshot-documented drive of the whole onboarding hand-off over the LIVE backend, left in the
// repo as a re-runnable CI asset (run with `node`, never the Playwright MCP).
//
// One continuous anonymous session carries the journey end to end:
//   discovery Q1 (a role) -> tap the essential floor -> #25 handoff bridge -> nav to /deck reveal
//   -> "See them" as anon -> the #22 wall (Google leading, magic-link secondary, no card yet)
//   -> send the magic link -> "Check your email" + dev link -> follow it (anon->account merge)
//   -> resume on /deck now AUTHED -> "See them" -> the card (the % ring), no wall.
//
// The discovery start/answer + card scoring are deterministic (matchtick.ts is pure arithmetic), so
// this rides the real API — no stubbing. Anon scoring is proven simply by the reveal appearing with
// a real match count before any sign-in (#22 AC1).
//
// Run:  BASE_URL=http://127.0.0.1:4020 node e2e/onboarding-reveal-wall.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4020";
const ROLE = "IT project manager in Paris";
const EMAIL = "reveal-wall-e2e@example.com";

const qa = await createSession("onboarding-reveal-wall", { baseURL: BASE_URL });
const { page } = qa;

// ---- discovery: answer Q1 + today's complete question set, human-paced ------------------------
await qa.goto("/discovery", "front door -> discovery (bootstraps the anonymous session on mount)");
await qa.scrollThrough("read the discovery screen");
await qa.fill("#q1-role", ROLE, `question 1: type the role — "${ROLE}"`);
await qa.click("button.go.wide", "submit the role ('That's me')");

// Walk the current floor and the first two eligibility questions. The languages checkbox group is
// deliberately left for the closing answer below so the transient handoff can still be captured.
await qa.expectVisible("#ask-q", "the first floor question is asked");
let answered = 0;
for (let i = 0; i < 12 && !(await page.locator("fieldset.elig-group").count()); i++) {
  const option = page.locator(".discovery .opts .opt").first();
  if (await option.count()) {
    const label = (await option.textContent()).trim();
    await qa.click(option, `answer ${i + 1}: "${label}"`);
  } else if (await page.locator("#floor-free").count()) {
    await qa.fill("#floor-free", "Owned a $2M budget at Acme from 2021 to 2024", `answer ${i + 1}: type the evidence`);
    await qa.click(".discovery .field .go", `answer ${i + 1}: Continue`);
  } else {
    break;
  }
  answered += 1;
  await page.waitForTimeout(1200);
}
await qa.note(`answered ${answered} questions before the closing languages multi-select`);
await qa.expectVisible("fieldset.elig-group", "the final languages question is on screen");
// #205: #165 replaced the checkbox list with a type-ahead — a person now TYPES a language and adds
// it, and the checkbox group only renders as the server-flagged fallback. This journey had been red
// (and in no CI tier, so unwatched) ever since. Drive whichever shape is actually on screen.
if (await page.locator(".discovery .lang-typeahead").count()) {
  await qa.fill("#lang-input", "English", "type the first language into the type-ahead");
  await qa.click(".discovery .lang-typeahead .field .go", "add it to the list");
} else {
  await qa.click(page.locator(".discovery .opt.check").first(), "tick the first supported language");
}

// #25 AC1: confirming the closing answer flips stage->deck. Click it raw (skipping the driver's trailing pause)
// so the transient ~800ms handoff bridge is still on screen when the next assertion screenshots it.
await qa.note("confirm the closing languages answer — this completes the current discovery set (stage -> deck)");
await page.locator(".discovery .elig-actions .go").click();

// The #18 handoff still shows first, as the brief bridge before the nav. It is transient (~800ms
// by design), so poll for it to render (the driver's own assert is a single-shot check) before
// screenshotting the evidence.
await page.locator(".handoff .q").waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
await qa.expectVisible(
  page.getByText("That's all I need to ask.", { exact: true }),
  "#25: the deck handoff bridge shows ('That's all I need to ask.') before navigating",
);
// #25 AC2: the discovery side must NOT announce the handoff — only /deck's entry effect announces,
// once. If it regressed to double-announcing, this live region would carry the handoff copy.
const discoveryAnnounced = await page
  .locator(".discovery .sr-only")
  .textContent()
  .catch(() => "");
qa.note(`#25 AC2 (no double-announce): discovery .sr-only after handoff = "${(discoveryAnnounced || "").trim()}" (must NOT contain the handoff copy)`);

// ---- the reveal: #25 nav landed, announced once ----------------------------------------------
await page.waitForURL("**/deck", { timeout: 5000 });
await qa.expectVisible(
  page.getByRole("heading", { name: /matched you/ }),
  "#25 AC1: navigated to the /deck reveal — the 'N jobs just matched you' headline",
);
const revealFocused = await page.evaluate(() => document.activeElement?.tagName === "H1");
qa.note(`#25 AC2 focus: the reveal <h1> is the focused element on entry = ${revealFocused}`);
const revealLive = await page.locator('.jobdeck [aria-live="polite"]').textContent().catch(() => "");
qa.note(`#25 AC2 announce (once): /deck live region = "${(revealLive || "").trim()}"`);
const cardBefore = await page.getByRole("img", { name: /% match/ }).count();
qa.note(`#22 AC1 anon scoring: the reveal shows a real match count with NO sign-in and NO earlier auth block; job card mounted before 'See them' = ${cardBefore} (expected 0)`);

// ---- #22: 'See them' as an anonymous visitor -> the wall, not the card -----------------------
await qa.click(page.getByRole("button", { name: "See them" }), "#22: press 'See them' as an anonymous visitor");
await qa.expectVisible(
  page.getByRole("heading", { name: /matched you/ }),
  "#22 AC2: the reward heading STAYS above the ask (the wall replaced the button in-place, not a redirect)",
);
await qa.expectVisible(
  page.getByRole("link", { name: "Continue with Google" }),
  "#22 AC2: Google OAuth is the leading action",
);
await qa.expectVisible(page.locator(".wall .divider"), "#22 AC2: the 'or' divider sits above the magic-link secondary");
await qa.expectVisible(page.getByLabel("Email address"), "#22 AC2: magic link (email) is the secondary action");
const cardAtWall = await page.getByRole("img", { name: /% match/ }).count();
qa.note(`#22 AC2: no job card is visible behind the wall = ${cardAtWall} (expected 0)`);

// ---- #22: the magic-link path -----------------------------------------------------------------
await qa.fill(page.getByLabel("Email address"), EMAIL, `enter an email — ${EMAIL}`);
await qa.click(page.getByRole("button", { name: "Email me a sign-in link" }), "send the sign-in link");
await qa.expectVisible(page.getByText("Check your email"), "the wall confirms 'Check your email'");
await qa.expectVisible(
  page.getByRole("link", { name: "Open your sign-in link (dev)" }),
  "the dev sign-in link is offered (no mailer configured)",
);

// ---- #22 AC3 / #64 AC3: follow the dev link -> anon->account merge -> the top job, directly -----
await qa.note("follow the dev sign-in link — claims THIS anon session (the AC3 merge) and resumes via jc_return");
await page.getByRole("link", { name: "Open your sign-in link (dev)" }).click();
// #64: the wall stashes /deck?claimed=1, so match on the path — a "**/deck" glob is compared against
// the whole URL and would time out on the query string the resume now carries.
await page.waitForURL((url) => url.pathname === "/deck", { timeout: 8000 });
// /deck re-loads its cards async on entry (a brief 'loading' state) — wait the card out of it before
// the single-shot assertions.
await page.getByRole("img", { name: /% match/ }).waitFor({ state: "visible", timeout: 8000 });
await qa.scrollThrough("read the job that opened on its own");

// #64 AC3: she earned the reveal BEFORE signing in, so it is not sold to her twice. The highest-
// ranked job is on screen with no second curtain and no second "See them" in between.
await qa.expectVisible(page.getByRole("img", { name: /% match/ }), "#64 AC3: the highest-ranked job opened directly on resume");
// `.deckcount` ("1 of N matched today") only ever renders on the deck screen itself, so seeing it
// here IS the proof that the curtain was skipped rather than clicked through — and "1 of" is the
// first card, the highest-ranked one.
await qa.expectText(".jobdeck .deckcount", "1 of", "#64 AC3: she is on the FIRST card of the deck, with no curtain in between");
const secondReveal = await page.getByRole("button", { name: "See them" }).count();
await qa.note(`#64 AC3: no second reveal between signing in and the job ('See them' count = ${secondReveal}, expected 0)`);
const wallAfter = await page.getByRole("link", { name: "Continue with Google" }).count();
await qa.note(`#22 AC4: the wall never re-shows for the authed visitor (Google link count on the card view = ${wallAfter}, expected 0)`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
