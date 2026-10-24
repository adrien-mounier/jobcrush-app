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
  scored: "judged" as const,
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

async function stubCards(page: Page, authed: boolean, cards = [CARD]) {
  const body: CardsResponse = { stage: "deck", cards, authed, pendingCount: 0 };
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

// #22 AC3 + #64 AC3: a same-browser OAuth success reads the wall's jc_return stash, lands back on
// the deck (not /import), consumes the stash (one-shot — a stale entry can't hijack a later sign-in,
// the bug the Standards review caught), and opens the highest-ranked job DIRECTLY. The reveal was
// earned before she signed in; showing the curtain again would charge her for it twice.
test("resume: a claimed return opens the highest-ranked job, never a second reveal", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jc_return", "/deck?claimed=1"));
  await stubCards(page, true, [CARD, { ...CARD, adId: "ad-2", title: "Delivery Lead", matchPct: 61 }]);

  await page.goto("/auth/verify?oauth=ok");
  await page.waitForURL("/deck?claimed=1");

  // The card is on screen with no "See them" in between, and it is the first (highest-ranked) one.
  await expect(page.getByRole("img", { name: /% match/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "IT Project Manager" })).toBeVisible();
  await expect(page.getByRole("button", { name: "See them" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("jc_return"))).toBeNull();
  // The flag is spent on the way in, so a reload or a bookmark can never keep skipping the reveal.
  await expect(page).toHaveURL(/\/deck$/);

  // Skipping the reveal must not skip what the reveal DID: the count is still announced once, and
  // the card heading holds the focus a sighted visitor's eye lands on.
  await expect(page.locator('.jobdeck [aria-live="polite"]')).toHaveText(/2 jobs just matched you/);
  await expect(page.getByRole("heading", { name: "IT Project Manager" })).toBeFocused();
});

// #123's L7 outranks #64's shortcut. The withdrawal sentence lives on the reveal and nowhere else,
// so a resume that had one to say still shows the curtain: being told a job was removed beats being
// spared one more tap.
test("resume: a withdrawal to report keeps the reveal, shortcut or not", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jc_return", "/deck?claimed=1"));
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({
      json: {
        stage: "deck",
        cards: [CARD],
        authed: true,
        pendingCount: 0,
        withdrawn: { total: 2, byLanguage: [{ language: "English", count: 2, missing: false }] },
      } as CardsResponse,
    });
  });

  await page.goto("/auth/verify?oauth=ok");
  await page.waitForURL("/deck?claimed=1");

  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
  // Scoped to the aside: the live region carries the same sentence, so a bare text match is ambiguous.
  await expect(page.locator(".jobdeck .aside")).toHaveText("I left out 2 jobs that need English, because you said you don't speak it.");
  await expect(page.getByRole("button", { name: "See them" })).toBeVisible();
});

// #425 AC5 — the reveal's line: one per language, with its count. A language not on her profile
// asks, and its "Yes, I speak it" adds the language and reads the deck again; one she said she does
// not speak only says so.
test.describe("#425 the reveal names each language it left out", () => {
  const withdrawnDeck = (cards = [CARD]): CardsResponse => ({
    stage: "deck",
    cards,
    authed: true,
    pendingCount: 0,
    withdrawn: {
      total: 13,
      byLanguage: [
        { language: "Cantonese", count: 12, missing: true },
        { language: "Thai", count: 1, missing: false },
      ],
    },
  });

  test("a line per language, the missing one with its button; 'Yes, I speak Cantonese' brings the jobs back", async ({ page }) => {
    const sent: unknown[] = [];
    let saved = false;
    const back = [CARD, ...Array.from({ length: 12 }, (_, n) => ({ ...CARD, adId: `hk-${n}` }))];
    await page.route("**/api/onboarding/cards", (route) =>
      route.fulfill({
        json: saved
          ? { ...withdrawnDeck(back), withdrawn: { total: 1, byLanguage: [{ language: "Thai", count: 1, missing: false }] } }
          : withdrawnDeck(),
      }),
    );
    await page.route("**/api/review/languages/spoken", async (route) => {
      sent.push(route.request().postDataJSON());
      saved = true;
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/deck");

    const lines = page.locator(".jobdeck .curtain .aside");
    await expect(lines).toHaveText([
      "I left out 12 jobs that need Cantonese, which isn't on your profile. Do you speak it?Yes, I speak Cantonese",
      "I left out 1 job that needs Thai, because you said you don't speak it.",
    ]);
    await expect(lines.nth(1).getByRole("button")).toHaveCount(0); // a no stands — no way back offered here
    await expect(page.getByRole("heading", { name: "1 job just matched you" })).toBeVisible();

    await page.getByRole("button", { name: "Yes, I speak Cantonese" }).click();

    await expect(page.getByRole("heading", { name: "13 jobs just matched you" })).toBeVisible();
    await expect(lines).toHaveText(["I left out 1 job that needs Thai, because you said you don't speak it."]);
    expect(sent).toEqual([{ language: "Cantonese" }]);
    await expect(page.getByRole("heading", { name: /matched you/ })).toBeFocused();
  });

  test("a failed save says so, and the button is there to try again", async ({ page }) => {
    await page.route("**/api/onboarding/cards", (route) => route.fulfill({ json: withdrawnDeck() }));
    await page.route("**/api/review/languages/spoken", (route) =>
      route.fulfill({ status: 500, json: { error: { code: "boom", message: "x" } } }),
    );
    await page.goto("/deck");

    await page.getByRole("button", { name: "Yes, I speak Cantonese" }).click();

    await expect(page.locator(".jobdeck .curtain").getByRole("alert")).toHaveText("Couldn't save that — try again.");
    await expect(page.getByRole("button", { name: "Yes, I speak Cantonese" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Yes, I speak Cantonese" })).toBeFocused(); // she is still on it
    await expect(page.getByRole("heading", { name: "1 job just matched you" })).toBeVisible();
  });

  // The worst case — the rule took every job — must not be the silent one.
  test("an empty deck still names what it left out, and 'Yes, I speak it' brings the jobs back", async ({ page }) => {
    let saved = false;
    const emptied: CardsResponse = { ...withdrawnDeck([]), withdrawn: { total: 2, byLanguage: [{ language: "Cantonese", count: 2, missing: true }] } };
    await page.route("**/api/onboarding/cards", (route) =>
      route.fulfill({ json: saved ? { ...withdrawnDeck([CARD, { ...CARD, adId: "hk-1" }]), withdrawn: { total: 0, byLanguage: [] } } : emptied }),
    );
    await page.route("**/api/review/languages/spoken", async (route) => {
      saved = true;
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/deck");

    await expect(page.getByText("No matches yet.")).toBeVisible();
    await expect(page.locator(".jobdeck .loadstate .aside")).toHaveText(
      "I left out 2 jobs that need Cantonese, which isn't on your profile. Do you speak it?Yes, I speak Cantonese",
    );
    await page.getByRole("button", { name: "Yes, I speak Cantonese" }).click();

    await expect(page.getByRole("heading", { name: "2 jobs just matched you" })).toBeVisible();
    await expect(page.locator(".jobdeck .aside")).toHaveCount(0);
  });

  test("nothing withdrawn: no line, no reserved space", async ({ page }) => {
    await stubCards(page, true);
    await page.goto("/deck");
    await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
    await expect(page.locator(".jobdeck .curtain .aside")).toHaveCount(0);
  });
});

// The flag is not a general "skip the reveal" switch: it only fires on a session the server says is
// claimed, and a returning visitor arriving at a bare /deck still gets her reveal.
test("resume: an unclaimed session with the flag still meets the wall", async ({ page }) => {
  await stubCards(page, false);
  await page.goto("/deck?claimed=1");

  await expect(page.getByRole("button", { name: "See them" })).toBeVisible();
  await page.getByRole("button", { name: "See them" }).click();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});

// The stash is what carries the flag, so it is pinned where it is written: both doors out of the
// wall must mark the return, or the resumed visitor lands on a second curtain.
test("the wall stashes the claimed return path before either sign-in door opens", async ({ page }) => {
  await stubCards(page, false);
  await page.route("**/api/auth/request-link", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/deck");
  await page.getByRole("button", { name: "See them" }).click();

  // Door 1, the leading one: Google. Its navigation is aborted so the assertion is about the stash
  // the click writes, not about a round-trip to Google.
  await page.route("**/api/auth/google*", (route) => route.abort());
  await page.getByRole("link", { name: "Continue with Google" }).click();
  expect(await page.evaluate(() => localStorage.getItem("jc_return"))).toBe("/deck?claimed=1");

  // Door 2: the magic link.
  await page.evaluate(() => localStorage.removeItem("jc_return"));
  await page.getByLabel("Email address").fill("visitor@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("jc_return"))).toBe("/deck?claimed=1");
});
