import { expect, test, type Page } from "@playwright/test";

// #19 the reveal + the job card (screen 2a), end to end over the real API. GET /onboarding/cards
// and the whole discovery answer pipeline for a known role are deterministic, non-LLM (matchtick.ts
// is pure arithmetic) — so this rides the real backend instead of stubbing at the route layer,
// reusing apps/api/test/cards.test.ts's own fixture (role + itemIds) to get a non-trivial card: two
// confirmed "yes" facts (-> gold checks) and one recorded "no" (-> a dim, never-a-cross dot) so all
// three mark states are actually exercised, not just asserted absent.
//
// `/deck` is not server-gated (the client decides when to show it — design-19-reveal-card.md §1.3),
// so this seeds the session's discovery answers via direct API calls (and, since #22, signs the
// session in so the reveal's wall lets the card through), then navigates to /deck straight,
// mirroring errors.spec.ts's direct-navigation pattern.
const ROLE = "IT project manager in Paris";

async function seedNonTrivialCard(page: Page) {
  // ensureSession() is called client-side on mount — visiting a page that calls it is the simplest
  // way to establish the anonymous session cookie before driving the same endpoints directly.
  const bootstrapped = page.waitForResponse(
    (res) => res.url().endsWith("/api/onboarding/discovery") && res.request().method() === "GET",
  );
  await page.goto("/discovery");
  await bootstrapped;

  // In-page fetch, not page.request: the session cookie is Secure, and Playwright's page.request is
  // a plain Node HTTP client that (correctly) won't attach a Secure cookie over http://127.0.0.1 —
  // only the real browser page context gets the loopback "potentially trustworthy origin" exception
  // that lets it ride along, same as every other client-side call this app makes.
  await page.evaluate(async (role) => {
    const post = (url: string, body: unknown) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await post("/api/onboarding/discovery/start", { role });
    await post("/api/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    await post("/api/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, multiple teams",
    });
    await post("/api/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" });
    // #22: the reveal now walls an anonymous "See them" (that gate is covered by wall.spec.ts). This
    // is the 2a card-anatomy test, so it must reach the card — claim THIS session (which holds the
    // answers above) via the real magic-link path so GET /onboarding/cards returns authed:true. Done
    // in-page so the Secure session cookie rides along, same reason as the discovery calls above.
    const link = await (await post("/api/auth/request-link", { email: "deck-e2e@example.com" })).json();
    const token = new URL("http://x" + (link.devLink as string)).searchParams.get("token");
    await post("/api/auth/verify", { token });
  }, ROLE);
}

test("screen 2a: the reveal, then the top card's ring, all three marks, and the folded ad — never a cross", async ({
  page,
}) => {
  await seedNonTrivialCard(page);
  await page.goto("/deck");

  // AC1: one line, one button — the deck itself isn't mounted yet.
  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
  const seeThem = page.getByRole("button", { name: "See them" });
  await expect(seeThem).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you fit" })).toHaveCount(0);

  await seeThem.click();

  // AC2 + AC4: the deck opens straight onto the (best) card — the % ring is the one number here.
  await expect(page.getByRole("img", { name: /% match/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you fit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you don't — yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Asked and closed" })).toBeVisible();

  // The ad is folded shut, last.
  await expect(page.getByText("Read the ad in full")).toBeVisible();
  await expect(page.locator("details.ad")).not.toHaveAttribute("open", "");

  // AC5: only the three neutral marks ever appear — never a cross, in any of its glyph forms.
  await expect(page.getByText("✗", { exact: true })).toHaveCount(0);
  await expect(page.getByText("✕", { exact: true })).toHaveCount(0);
  await expect(page.getByText("×", { exact: true })).toHaveCount(0);
});
