import { expect, test, type Page } from "@playwright/test";
import type { CardsResponse } from "../lib/api";

// #22 the account wall at the reveal — swaps in for the "See them" button inside the existing
// .curtain (design-22-wall.md §1), gated on the single `authed` flag GET /onboarding/cards now
// carries. GET /onboarding/cards is stubbed at the route layer (prior art: discovery.spec.ts's
// idiom, and deck.spec.ts's own JobCard fixture shape) so `authed` is deterministic here — session
// bootstrap (/api/sessions/*) rides the real API, same assumption discovery.spec.ts makes.

const CARD = {
  schemaVersion: "1" as const,
  adId: "ad-1",
  title: "IT Project Manager",
  company: "Acme",
  place: "Paris",
  salary: null,
  pattern: null,
  matchPct: 82,
  breakdown: {
    essential: { met: 2, total: 3 },
    desirable: { met: 1, total: 2 },
  },
  bubble: { hit: "You match on delivery.", open: "" },
  fit: [],
  dontYet: [],
  askedClosed: [],
  adExcerpt: "excerpt",
};

async function stubCards(page: Page, authed: boolean) {
  const body: CardsResponse = { stage: "deck", cards: [CARD], authed };
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({ json: body });
  });
}

test("anonymous visitor: 'See them' shows the wall, not the card", async ({ page }) => {
  await stubCards(page, false);
  await page.goto("/deck");

  await page.getByRole("button", { name: "See them" }).click();

  // The wall: Google OAuth leading, magic link secondary.
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  // The reveal's reward heading stays mounted above the ask (§1) — never hidden by the wall.
  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();

  // The card is not shown.
  await expect(page.getByRole("img", { name: /% match/ })).toHaveCount(0);
});

test("signed-in visitor: 'See them' reveals the card, never the wall", async ({ page }) => {
  await stubCards(page, true);
  await page.goto("/deck");

  await page.getByRole("button", { name: "See them" }).click();

  await expect(page.getByRole("img", { name: /% match/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toHaveCount(0);
});

test("the wall's magic-link path: send shows 'Check your email' and the dev-link button", async ({ page }) => {
  await stubCards(page, false);
  await page.route("**/api/auth/request-link", async (route) => {
    await route.fulfill({
      json: { ok: true, devLink: "http://127.0.0.1:3000/auth/verify?token=dev-token" },
    });
  });
  await page.goto("/deck");

  await page.getByRole("button", { name: "See them" }).click();
  await page.getByLabel("Email address").fill("visitor@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page.getByText("Check your email")).toBeVisible();
  await expect(page.getByText(/We sent a sign-in link to visitor@example.com/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your sign-in link (dev)" })).toBeVisible();
  // Still above the wall, still no card.
  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /% match/ })).toHaveCount(0);
});

// AC3 + the resume() fix: a same-browser OAuth success reads the wall's jc_return stash, lands on
// /deck (not /import), consumes the stash (one-shot — a stale entry can't hijack a later sign-in,
// the bug the Standards review caught), and the merged session is authed there.
test("resume: a same-browser OAuth success returns to /deck and the wall never shows again", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jc_return", "/deck"));
  await stubCards(page, true);

  await page.goto("/auth/verify?oauth=ok");
  await page.waitForURL("/deck");

  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("jc_return"))).toBeNull();

  await page.getByRole("button", { name: "See them" }).click();
  await expect(page.getByRole("img", { name: /% match/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
});
