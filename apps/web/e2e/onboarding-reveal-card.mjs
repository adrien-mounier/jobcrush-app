// #19 the reveal + the job card (screen 2a) — a human-paced, screenshot-documented drive of the
// real onboarding journey over the live API, left in the repo as a re-runnable CI asset (run with
// `node`, never the Playwright MCP). Companion to the assertion-only deck.spec.ts: this one scrolls
// like a reader and captures highlighted-evidence screenshots + a self-contained HTML report.
//
// It also documents the discovery -> /deck reachability boundary: after the essential band is
// answered the discovery screen shows the static handoff placeholder and does NOT navigate to
// /deck, so /deck is reached here by direct navigation (design-19 §1.3: the client decides).
//
// Run:  BASE_URL=http://127.0.0.1:3020 node e2e/onboarding-reveal-card.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3020";
const ROLE = "IT project manager in Paris";

const qa = await createSession("onboarding-reveal-card", { baseURL: BASE_URL });
const { page } = qa;

// 1) Bootstrap the anonymous session (ensureSession runs client-side on /discovery mount), then
//    seed the essential band straight over the API in-page so the Secure loopback cookie rides
//    along — two "yes" (gold checks) + one "no" (a dim, never-a-cross dot). This closes the
//    essential band and flips the session to the deck stage.
await qa.goto("/discovery", "bootstrap the anonymous session on the discovery screen");
const seed = await page.evaluate(async (role) => {
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.status);
  const codes = [];
  codes.push(await post("/api/onboarding/discovery/start", { role }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "cross-functional-leadership", answer: "Yes, multiple teams" }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" }));
  return codes;
}, ROLE);
qa.note(`seeded the essential band over the real API — POST status codes: ${seed.join(", ")}`);

// 2) The reachability boundary: reload discovery with the band answered. The stage is now "deck",
//    yet the discovery screen dead-ends on the static handoff — it never routes to /deck.
await qa.goto("/discovery", "reload discovery with the essential band answered");
await qa.expectVisible(
  page.getByText("That's all I need to ask.", { exact: true }),
  "discovery dead-ends on the static handoff placeholder (no auto-advance to /deck)",
);
qa.note(`discovery URL after the band is answered: ${new URL(page.url()).pathname} (still /discovery — the reveal is NOT reached from the flow, only by direct navigation)`);

// 3) The reveal (AC1): direct-navigate to /deck. One line, one button, nothing behind it.
await qa.goto("/deck", "direct-navigate to the reveal (as the deck is reached by design)");
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), "the reveal shows one headline: '… just matched you'");
await qa.expectVisible(page.getByRole("button", { name: "See them" }), "one button: 'See them'");
const behind = await page.getByRole("heading", { name: "Where you fit" }).count();
qa.note(`AC1 nothing-behind-the-curtain: deck card headings present before 'See them' = ${behind} (expected 0)`);

// 4) Open the deck (AC2 + AC4): it opens straight onto the best (top) card. Read it like a human.
await qa.click(page.getByRole("button", { name: "See them" }), "press 'See them' — the deck opens on the best match");
await qa.scrollThrough("read the card top to bottom");
await qa.expectVisible(page.getByRole("img", { name: /% match/ }), "the match % ring — the one number on the card");
await qa.expectVisible(page.locator(".jobcard h2").first(), "card leads with the job title");
await qa.expectVisible(page.locator(".bubble"), "the highlight bubble sits under the score (strongest hit + biggest open)");
await qa.expectVisible(page.getByRole("heading", { name: "Where you fit" }), "'Where you fit' — my confirmed facts");
await qa.expectVisible(page.getByRole("heading", { name: "Where you don't — yet" }), "'Where you don't — yet' — the ad's open asks");
await qa.expectVisible(page.getByRole("heading", { name: "Asked and closed" }), "'Asked and closed' — the recorded 'no'");

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
await qa.expectVisible(page.locator(".row.settled .mk").first(), "a dim · marks an asked-and-closed row");

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
