import { expect, test, type Page } from "@playwright/test";
import type { CardsResponse, CvSection, DiscoveryState, JobCard, ScoredJobCard } from "../lib/api";

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

const RAIL_ZERO: Record<CvSection, number> = { summary: 0, experience: 0, skills: 0, education: 0 };

// #117: ScoredJobCard, not the JobCard union — these fixtures stub the network response directly,
// so nothing here rides the real fallback-scorer path; "judged" is simply a normal already-scored
// card for these tests. Typed as the concrete variant (not JobCard) so the `card()` helper below can
// override matchPct without TS having to reason about a spread of an unresolved union.
const CARD_BASE: ScoredJobCard = {
  schemaVersion: "1",
  adId: "ad-1",
  title: "IT Project Manager",
  company: "Acme",
  place: "Paris",
  salary: null,
  pattern: null,
  scored: "judged",
  matchPct: 82,
  breakdown: {
    essential: { met: 2, total: 3 },
    desirable: { met: 1, total: 2 },
  },
  bubble: { hit: "You match on delivery.", open: "The gap is SAP." },
  fit: [],
  dontYet: [],
  askedClosed: [],
  adExcerpt: "excerpt",
};

function card(adId: string, title: string, matchPct: number): ScoredJobCard {
  return { ...CARD_BASE, adId, title, matchPct };
}

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

async function stubCards(page: Page, cards: JobCard[]) {
  const body: CardsResponse = { stage: "deck", cards, authed: true, pendingCount: 0 };
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({ json: body });
  });
}

async function openStubbedDeck(page: Page, cards: JobCard[]) {
  await stubSession(page);
  await stubCards(page, cards);
  await page.goto("/deck");
  await page.getByRole("button", { name: "See them" }).click();
}

test("match breakdown renders server band values as an accessible four-fact description list", async ({
  page,
}) => {
  await openStubbedDeck(page, [CARD_BASE]);

  const breakdown = page.getByRole("region", { name: "Match breakdown" });
  await expect(breakdown.locator("dt")).toHaveText([
    "Requirements met",
    "Essential met",
    "Desirable met",
    "Match quality",
  ]);
  await expect(breakdown.locator("dd")).toHaveText(["3/5", "2/3", "1/2", "Strong"]);
  await expect(breakdown.getByLabel("3 5 requirements met")).toBeVisible();
  await expect(breakdown.getByLabel("2 3 essential requirements met")).toBeVisible();
  await expect(breakdown.getByLabel("1 2 desirable requirements met")).toBeVisible();
});

test("match breakdown preserves an empty band and omits only an all-zero scored card", async ({
  page,
}) => {
  await openStubbedDeck(page, [
    {
      ...CARD_BASE,
      breakdown: {
        essential: { met: 2, total: 3 },
        desirable: { met: 0, total: 0 },
      },
    },
    {
      ...CARD_BASE,
      adId: "ad-all-zero",
      title: "All-zero card",
      breakdown: {
        essential: { met: 0, total: 0 },
        desirable: { met: 0, total: 0 },
      },
    },
  ]);
  await expect(page.getByRole("region", { name: "Match breakdown" }).locator("dd")).toHaveText([
    "2/3",
    "2/3",
    "0/0",
    "Strong",
  ]);
  await page.getByRole("button", { name: "Not for me, show next job" }).click();
  await expect(page.getByRole("region", { name: "Match breakdown" })).toHaveCount(0);
});

for (const [matchPct, quality] of [
  [70, "Strong"],
  [50, "Partial"],
  [49, "Weak"],
] as const) {
  test(`match quality uses the ${matchPct}% threshold`, async ({ page }) => {
    await openStubbedDeck(page, [{ ...CARD_BASE, matchPct }]);
    await expect(page.getByRole("region", { name: "Match breakdown" }).getByText(quality)).toBeVisible();
  });
}

for (const width of [360, 390]) {
  test(`match breakdown remains a two-column grid without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openStubbedDeck(page, [CARD_BASE]);
    const grid = page.getByRole("region", { name: "Match breakdown" }).locator("dl");
    await expect(grid).toHaveCSS("grid-template-columns", /.+px .+px/);
    expect(
      await page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        grid: (() => {
          const element = document.querySelector(".bd-grid");
          return element ? element.scrollWidth <= element.clientWidth : false;
        })(),
      })),
    ).toEqual({ document: true, grid: true });
  });
}

async function stubStageReset(page: Page) {
  let postedStage: string | null = null;
  await page.route("**/api/sessions/me/stage", async (route) => {
    postedStage = (route.request().postDataJSON() as { stage: string }).stage;
    await route.fulfill({ json: { ok: true } });
  });
  return () => postedStage;
}

async function stubLoopbackDiscovery(page: Page, overrides: Partial<DiscoveryState> = {}) {
  const state: DiscoveryState = {
    stage: "discovery",
    role: "IT Project Manager",
    family: "project manager",
    city: "Paris",
    promise: { family: "project manager", city: "Paris", count: 142 },
    questions: [
      {
        itemId: "budget",
        question: "Have you managed a budget?",
        options: ["Yes", "No"],
        cvSection: "experience",
      },
    ],
    railFill: RAIL_ZERO,
    essentialRemaining: 1,
    cvLines: [
      { itemId: "role", section: "summary", text: "IT Project Manager" },
      { itemId: "years", section: "experience", text: "5 to 10 years of experience as a project manager." },
    ],
    factCount: 2,
    ...overrides,
  };
  await page.route("**/api/onboarding/discovery", async (route) => {
    await route.fulfill({ json: state });
  });
}

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

test("screen 2b: 'Not for me' advances to the next card", async ({ page }) => {
  await openStubbedDeck(page, [
    card("ad-1", "IT Project Manager", 82),
    card("ad-2", "Delivery Lead", 74),
    card("ad-3", "Programme Manager", 68),
  ]);

  await page.getByRole("button", { name: "Not for me, show next job" }).click();

  await expect(page.getByText("2 of 3 matched today · swipe or tap")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery Lead" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery Lead" })).toBeFocused();
});

test("screen 2b: 'I want this one' posts the visible card and shows the Tailor handoff", async ({ page }) => {
  let wantedAdId: string | null = null;
  await page.route("**/api/onboarding/cards/*/want", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    wantedAdId = parts[parts.length - 2] ?? null;
    await route.fulfill({ json: { stage: "tailor", adId: wantedAdId } });
  });
  await openStubbedDeck(page, [
    card("ad-1", "IT Project Manager", 82),
    card("ad-2", "Delivery Lead", 74),
  ]);

  await page.getByRole("button", { name: "I want this one, tailor this job" }).click();

  const heading = page.getByRole("heading", { name: "Tailoring this one" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("Tell me more and this CV gets stronger for this job.")).toBeVisible();
  expect(wantedAdId).toBe("ad-1");
});

test("screen 2b: exhausting the deck loops back to discovery with the widen-net copy and saved answers", async ({
  page,
}) => {
  const postedStage = await stubStageReset(page);
  await stubLoopbackDiscovery(page);
  await openStubbedDeck(page, [
    card("ad-1", "IT Project Manager", 82),
    card("ad-2", "Delivery Lead", 74),
    card("ad-3", "Programme Manager", 68),
  ]);

  const notForMe = page.getByRole("button", { name: "Not for me, show next job" });
  await notForMe.click();
  await expect(page.getByText("2 of 3 matched today · swipe or tap")).toBeVisible();
  await notForMe.click();
  await expect(page.getByText("3 of 3 matched today · swipe or tap")).toBeVisible();
  await notForMe.click();

  await page.waitForURL("/discovery?loop=deck-exhausted");
  expect(postedStage()).toBe("discovery");
  await expect(page.getByText("I scored the three closest — tell me more and I'll widen the net")).toBeVisible();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeFocused();
});

test("screen 2b: deck-exhausted discovery stage still shows an answering retry, not the old handoff", async ({
  page,
}) => {
  await stubSession(page);
  await stubLoopbackDiscovery(page, { stage: "deck", questions: [], essentialRemaining: 0 });

  await page.goto("/discovery?loop=deck-exhausted");

  await expect(page.getByText("I scored the three closest — tell me more and I'll widen the net")).toBeVisible();
  await expect(page.getByText("That's all I need to ask.")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Answer more questions" });
  await expect(retry).toBeVisible();
  await expect(retry).toBeFocused();
});

test("screen 2b: an unknown want response shows fixed copy, never the raw envelope", async ({ page }) => {
  await page.route("**/api/onboarding/cards/*/want", async (route) => {
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "unknown card" } },
    });
  });
  await openStubbedDeck(page, [card("ad-1", "IT Project Manager", 82)]);

  const want = page.getByRole("button", { name: "I want this one, tailor this job" });
  await want.click();

  await expect(page.getByRole("alert").filter({ hasText: "That job is no longer available. Pick another one." })).toBeVisible();
  await expect(page.getByText("unknown card")).toHaveCount(0);
  await expect(want).toBeFocused();
});

test("screen 2b: a want auth failure shows generic fixed copy, never the raw envelope", async ({ page }) => {
  await page.route("**/api/onboarding/cards/*/want", async (route) => {
    await route.fulfill({
      status: 401,
      json: { error: { code: "login_required", message: "sign in first" } },
    });
  });
  await openStubbedDeck(page, [card("ad-1", "IT Project Manager", 82)]);

  const want = page.getByRole("button", { name: "I want this one, tailor this job" });
  await want.click();

  await expect(page.getByRole("alert").filter({ hasText: "Couldn't start tailoring this job — try again." })).toBeVisible();
  await expect(page.getByText("sign in first")).toHaveCount(0);
  await expect(want).toBeFocused();
});
