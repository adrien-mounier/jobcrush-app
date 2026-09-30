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

async function stubCards(page: Page, cards: JobCard[], moreQuestions?: boolean) {
  const body: CardsResponse = { stage: "deck", cards, authed: true, pendingCount: 0, ...(moreQuestions === undefined ? {} : { moreQuestions }) };
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
    promise: { count: 142 },
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
    // #216: the floor items are READ off the live state, never hard-coded. This spec used to name
    // the retired seven-item stub's ids; every one answered 404 `unknown_item`, so no fact was
    // recorded and the card below rendered with an empty "Where you fit". The floor is the placed
    // family's published research now, and it changes when the research does.
    const state = await (await fetch("/api/onboarding/discovery")).json();
    const floor = (state.questions ?? [])
      .filter((q: { eligibility?: unknown }) => !q.eligibility)
      .map((q: { itemId: string }) => q.itemId);
    for (let i = 0; i < floor.length; i += 1) {
      // The last item answered "No" keeps this spec's asked-and-closed fact.
      await post("/api/onboarding/discovery/answer", {
        itemId: floor[i],
        answer: i === floor.length - 1 ? "No" : "Yes, over $1M across multiple teams",
      });
    }
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
  // #311 (#287 c4): the recorded "no" is no longer recited on every card — the denial's section
  // appears only on a posting that asks for it in the denial's own words, which this live deck's
  // top card may or may not. Its anatomy (heading, · mark, no door on the deck) is pinned by the
  // stubbed "#311: a named denial" test below; what this live test still owes is "never a cross".

  // The ad is folded shut, last.
  await expect(page.getByText("Read the ad in full")).toBeVisible();
  await expect(page.locator("details.ad")).not.toHaveAttribute("open", "");

  // AC5: only the three neutral marks ever appear — never a cross, in any of its glyph forms.
  await expect(page.getByText("✗", { exact: true })).toHaveCount(0);
  await expect(page.getByText("✕", { exact: true })).toHaveCount(0);
  await expect(page.getByText("×", { exact: true })).toHaveCount(0);
});

// #311: a denial the posting asks for is named under its own heading, with the quiet · mark — and
// the DECK card carries no "Changed? Add it" door (the door belongs to the Tailor step, with the
// questions; CardBody only renders it when that screen passes the slot).
test("#311: a named denial reads 'You told me you don't have this', · mark, and no door on the deck", async ({
  page,
}) => {
  const denial = { id: "tailor-ad-1-sap", text: "Not applicable — SAP S/4HANA migration" };
  await openStubbedDeck(page, [{ ...card("ad-1", "IT Project Manager", 82), askedClosed: [denial] }]);

  await expect(page.getByRole("heading", { name: "You told me you don't have this" })).toBeVisible();
  await expect(page.getByText(denial.text)).toBeVisible();
  await expect(page.getByRole("button", { name: "Changed? Add it" })).toHaveCount(0);
  await expect(page.getByText("✗", { exact: true })).toHaveCount(0);
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
  await expect(page.getByText("I scored the three closest — tell me more and I'll score them better")).toBeVisible();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeFocused();
});

test("screen 2b: deck-exhausted discovery stage still shows an answering retry, not the old handoff", async ({
  page,
}) => {
  await stubSession(page);
  await stubLoopbackDiscovery(page, { stage: "deck", questions: [], essentialRemaining: 0 });

  await page.goto("/discovery?loop=deck-exhausted");

  await expect(page.getByText("I scored the three closest — tell me more and I'll score them better")).toBeVisible();
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

// #235 — the empty deck's second line is honest about whether a question actually remains: the
// "answer a few more questions" invitation only appears when one does; otherwise her own way to
// change the result — a different job title — is offered instead. No family, vocabulary or
// research is ever named.
test("an empty deck with no questions left invites a different job title, not more questions", async ({
  page,
}) => {
  await stubSession(page);
  await stubCards(page, [], false);
  await page.goto("/deck");
  await expect(page.getByText("No matches yet.")).toBeVisible();
  await expect(page.getByText("Try a different job title.")).toBeVisible();
  await expect(page.getByText("Answer a few more questions and I'll widen the net.")).toHaveCount(0);
});

test("an empty deck with questions still open keeps inviting them", async ({ page }) => {
  await stubSession(page);
  await stubCards(page, [], true);
  await page.goto("/deck");
  await expect(page.getByText("No matches yet.")).toBeVisible();
  await expect(page.getByText("Answer a few more questions and I'll widen the net.")).toBeVisible();
  await expect(page.getByText("Try a different job title.")).toHaveCount(0);
});

test("a retrieval still running waits for her original deck without showing a dead end or widening", async ({
  page,
}) => {
  await stubSession(page);
  let calls = 0;
  await page.route("**/api/onboarding/cards", async (route) => {
    calls += 1;
    await route.fulfill({
      json: calls === 1
        ? {
            stage: "deck",
            cards: [],
            authed: true,
            pendingCount: 0,
            searching: true,
            moreQuestions: false,
            fallback: {
              offered: true,
              declined: false,
              active: false,
              targetRole: "Product Analytics Manager",
            },
          }
        : {
            stage: "deck",
            cards: [card("ad-original", "Product Analytics Manager", 82)],
            authed: true,
            pendingCount: 0,
            searching: false,
            moreQuestions: false,
          },
    });
  });

  await page.goto("/deck");
  await expect(page.getByText("Still looking for your jobs…")).toBeVisible();
  await expect(page.getByText("No matches yet.")).toHaveCount(0);
  await expect(page.getByText(OFFER_QUESTION)).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "1 job just matched you" })).toBeVisible();
  await page.getByRole("button", { name: "See them" }).click();
  await expect(page.getByRole("heading", { name: "Product Analytics Manager" })).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);
});

test("a retrieval that finishes empty restores the existing dead end and eligible widening offer", async ({
  page,
}) => {
  await stubSession(page);
  let calls = 0;
  await page.route("**/api/onboarding/cards", async (route) => {
    calls += 1;
    await route.fulfill({
      json: {
        stage: "deck",
        cards: [],
        authed: true,
        pendingCount: 0,
        searching: calls === 1,
        moreQuestions: false,
        fallback: {
          offered: true,
          declined: false,
          active: false,
          targetRole: "Product Analytics Manager",
        },
      },
    });
  });

  await page.goto("/deck");
  await expect(page.getByText("Still looking for your jobs…")).toBeVisible();
  await expect(page.getByText("No matches yet.")).toHaveCount(0);

  await expect(page.getByText("No matches yet.")).toBeVisible();
  await expect(page.getByText(OFFER_QUESTION)).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, look" })).toBeVisible();
});

// #228 (spec #241) — the dead end becomes a choice. The offer is rendered from the server's own
// `fallback` state; the screen decides only WHEN the deck is finished. These are the durable twins
// of the human-paced journey in e2e/fallback-offer-journey.mjs.
const OFFER_QUESTION = "Your CV also proves other work. Do you want me to look there?";

async function stubFallbackCards(
  page: Page,
  cards: JobCard[],
  fallback: CardsResponse["fallback"],
) {
  const body: CardsResponse = { stage: "deck", cards, authed: true, pendingCount: 0, moreQuestions: false, fallback };
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({ json: body });
  });
}

test("the dead end asks whether to look at the work her CV proves, naming only her own words", async ({
  page,
}) => {
  await stubSession(page);
  await stubFallbackCards(page, [], {
    offered: true,
    declined: false,
    active: false,
    targetRole: "Product Analytics Manager",
  });
  await page.goto("/deck");
  await expect(page.getByText('There are no more jobs for "Product Analytics Manager".')).toBeVisible();
  await expect(page.getByText(OFFER_QUESTION)).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, look" })).toBeVisible();
  // It promises no jobs and names no job family, vocabulary or research (AC 3).
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const word of ["family", "vocabulary", "research", "strong matches"]) {
    expect(body).not.toContain(word);
  }
});

test("declining shows the honest dead end and leaves the offer reachable, without re-asking", async ({
  page,
}) => {
  await stubSession(page);
  await stubFallbackCards(page, [], {
    offered: true,
    declined: false,
    active: false,
    targetRole: "Product Analytics Manager",
  });
  await page.route("**/api/onboarding/cards/fallback", async (route) => {
    await route.fulfill({
      json: { fallback: { offered: false, declined: true, active: false, targetRole: "Product Analytics Manager" } },
    });
  });
  await page.goto("/deck");
  await page.getByRole("button", { name: "No thanks" }).click();

  await expect(page.getByText("Try a different job title.")).toBeVisible();
  await expect(page.getByText(OFFER_QUESTION)).toHaveCount(0);
  const back = page.getByRole("button", { name: "Look at the other work my CV proves" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByText(OFFER_QUESTION)).toBeVisible();
});

test("accepting replaces the deck with the jobs her CV proves", async ({ page }) => {
  await stubSession(page);
  let accepted = false;
  await page.route("**/api/onboarding/cards/fallback", async (route) => {
    accepted = true;
    await route.fulfill({
      json: { fallback: { offered: false, declined: false, active: true, targetRole: "Product Analytics Manager" } },
    });
  });
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = {
      stage: "deck",
      cards: accepted ? [card("ad-widened", "Delivery Manager", 74)] : [],
      authed: true,
      pendingCount: 0,
      moreQuestions: false,
      fallback: {
        offered: !accepted,
        declined: false,
        active: accepted,
        targetRole: "Product Analytics Manager",
      },
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/deck");
  await page.getByRole("button", { name: "Yes, look" }).click();

  await expect(page.getByRole("heading", { name: "Delivery Manager" })).toBeVisible();
  await expect(page.getByText(OFFER_QUESTION)).toHaveCount(0);
});

// The one decision this ticket puts on the CLIENT: the server says whether the offer CAN be
// honoured, the screen says when the deck is finished. So a visitor who still has cards must never
// see the offer, even though the payload says it is available.
test("cards still on screen never show the offer, however available the server says it is", async ({
  page,
}) => {
  await stubSession(page);
  await stubFallbackCards(page, [card("ad-1", "IT Project Manager", 82)], {
    offered: true,
    declined: false,
    active: false,
    targetRole: "Product Analytics Manager",
  });
  await page.goto("/deck");
  await page.getByRole("button", { name: "See them" }).click();

  await expect(page.getByRole("heading", { name: "IT Project Manager" })).toBeVisible();
  await expect(page.getByText(OFFER_QUESTION)).toHaveCount(0);
  await expect(page.getByText("No matches yet.")).toHaveCount(0);

  // …and it appears the moment she swipes past the last one — the same dead end an empty pool gives.
  await page.getByRole("button", { name: "Not for me, show next job" }).click();
  await expect(page.getByText(OFFER_QUESTION)).toBeVisible();
});

// #229 — the career changer is told, on the screen where the lower scores are. The sentence is the
// server's call (newToFamily), rendered once above the deck: never on the reveal (the count needs
// no caveat) and never per card. The scores themselves are untouched — the payload's matchPct is
// what renders, which is the ticket's one inviolable rule made visible.
const CHANGE_OF_DIRECTION = "This is a change of direction";

test("#229 a change-of-direction deck says so once, above the cards, and only there", async ({
  page,
}) => {
  await stubSession(page);
  const body: CardsResponse = {
    stage: "deck",
    cards: [card("ad-1", "IT Project Manager", 82)],
    authed: true,
    pendingCount: 0,
    newToFamily: true,
  };
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({ json: body });
  });
  await page.goto("/deck");

  // The reveal keeps its plain reward — the sentence waits for the deck.
  await expect(page.getByRole("heading", { name: /matched you/ })).toBeVisible();
  await expect(page.getByText(CHANGE_OF_DIRECTION)).toHaveCount(0);

  await page.getByRole("button", { name: "See them" }).click();
  await expect(page.getByText(CHANGE_OF_DIRECTION)).toBeVisible();
  // The score the server sent is the score on screen — the words carry the truth, never the number.
  await expect(page.getByRole("img", { name: "82% match" })).toBeVisible();
});

test("#229 no change of direction is claimed when the server does not say so", async ({ page }) => {
  await openStubbedDeck(page, [card("ad-1", "IT Project Manager", 82)]);
  await expect(page.getByRole("heading", { name: "IT Project Manager" })).toBeVisible();
  await expect(page.getByText(CHANGE_OF_DIRECTION)).toHaveCount(0);
});

// #228's widened deck is the work her CV proves — a different family she has real years in, so the
// server stops saying newToFamily and the banner must not persist over her own field's jobs.
test("#229 accepting the widening clears the change-of-direction banner", async ({ page }) => {
  await stubSession(page);
  let accepted = false;
  await page.route("**/api/onboarding/cards/fallback", async (route) => {
    accepted = true;
    await route.fulfill({
      json: { fallback: { offered: false, declined: false, active: true, targetRole: "Product Analytics Manager" } },
    });
  });
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = {
      stage: "deck",
      cards: accepted
        ? [card("ad-widened", "Delivery Manager", 74)]
        : [card("ad-target", "Product Analytics Manager", 31)],
      authed: true,
      pendingCount: 0,
      moreQuestions: false,
      newToFamily: !accepted,
      fallback: {
        offered: !accepted,
        declined: false,
        active: accepted,
        targetRole: "Product Analytics Manager",
      },
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/deck");
  await page.getByRole("button", { name: "See them" }).click();

  // Her target-family deck carries the sentence…
  await expect(page.getByRole("heading", { name: "Product Analytics Manager" })).toBeVisible();
  await expect(page.getByText(CHANGE_OF_DIRECTION)).toBeVisible();

  // …she runs out, accepts the widening, and the replacing deck is her own work — no sentence.
  await page.getByRole("button", { name: "Not for me, show next job" }).click();
  await page.getByRole("button", { name: "Yes, look" }).click();
  await expect(page.getByRole("heading", { name: "Delivery Manager" })).toBeVisible();
  await expect(page.getByText(CHANGE_OF_DIRECTION)).toHaveCount(0);
});
