import { expect, test, type Page } from "@playwright/test";
import type { DiscoveryState } from "../lib/api";

// #16 discovery (screen 1a) end to end: front door -> discovery, Q1 -> the promise -> the hand-off.
// Every /api/onboarding/discovery* call is stubbed at the route layer to the pinned DiscoveryState
// shape — deterministic and self-contained. Session bootstrap (/api/sessions/*) and the front door
// itself hit the real API.
//
// #339: no floor question, no countdown, no section rail. #376 (ADR-0018 clause 8): the server asks
// nothing after question 1 — work rights and languages are answered in the profile's check mode —
// and #386 removed this screen's question UI with the tests that pinned it (the eligibility asks,
// "Ask me later", their corrections, the languages multi-select): the server answers question 1
// with the hand-off itself, which is the shape every test below drives.

const BEFORE_START: DiscoveryState = {
  stage: "discovery",
  role: null,
  family: null,
  city: null,
  promise: null,
  questions: [],
  cvLines: [],
  factCount: 0,
};

// The server's real answer to question 1: the hand-off, no question.
const AFTER_START: DiscoveryState = {
  stage: "deck",
  role: "IT Project Manager",
  family: "project manager",
  city: null,
  promise: { count: 142 },
  questions: [],
  cvLines: [{ itemId: "role", section: "summary", text: "IT Project Manager" }],
  factCount: 1,
};

// Mutated by the /start stub below so a later GET (including one after a reload) resumes from
// wherever the flow last landed.
let current: DiscoveryState = BEFORE_START;

async function stubDiscovery(page: Page) {
  await page.route("**/api/onboarding/discovery/family**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    // "zzz" never matches anything — the silent-no-match path (design §4b), no family header.
    if (q.includes("zzz")) {
      await route.fulfill({ json: { family: null, suggestions: [] } });
    } else {
      await route.fulfill({
        json: {
          family: "project manager",
          suggestions: ["IT Project Manager", "Project Manager", "Programme Manager"],
        },
      });
    }
  });
  await page.route("**/api/onboarding/discovery/start", async (route) => {
    current = AFTER_START;
    await route.fulfill({ json: current });
  });
  await page.route("**/api/onboarding/discovery", async (route) => {
    await route.fulfill({ json: current });
  });
}

async function expectDiscoveryFitsViewport(page: Page) {
  const geometry = await page.locator(".discovery").evaluate((root) => {
    const ask = root.querySelector<HTMLElement>(".ask");
    const cv = root.querySelector<HTMLElement>(".band-cv");
    const cvPaper = root.querySelector<HTMLElement>(".cv");
    const cvColumn = root.querySelector<HTMLElement>(".cv-column");
    const askColumn = root.querySelector<HTMLElement>(".ask-column");
    const rootRect = root.getBoundingClientRect();
    const askRect = ask?.getBoundingClientRect();
    const cvRect = cv?.getBoundingClientRect();
    const cvPaperRect = cvPaper?.getBoundingClientRect();
    const cvColumnRect = cvColumn?.getBoundingClientRect();
    const askColumnRect = askColumn?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      root: { left: rootRect.left, right: rootRect.right, bottom: rootRect.bottom },
      ask: askRect
        ? { top: askRect.top, right: askRect.right, bottom: askRect.bottom, height: askRect.height }
        : null,
      cv: cvRect ? { top: cvRect.top, right: cvRect.right, height: cvRect.height } : null,
      cvPaper: cvPaperRect
        ? {
            height: cvPaperRect.height,
            aspectRatio: getComputedStyle(cvPaper!).aspectRatio,
          }
        : null,
      columns:
        cvColumnRect && askColumnRect
          ? { cvTop: cvColumnRect.top, askTop: askColumnRect.top }
          : null,
    };
  });

  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.root.left).toBeGreaterThanOrEqual(0);
  expect(geometry.root.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.root.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.ask).not.toBeNull();
  expect(geometry.cv).not.toBeNull();
  expect(geometry.cvPaper).not.toBeNull();
  expect(geometry.columns).not.toBeNull();
  expect(geometry.ask!.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.ask!.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.cv!.right).toBeLessThanOrEqual(geometry.viewportWidth);

  if (geometry.viewportWidth >= 900) {
    expect(Math.abs(geometry.columns!.askTop - geometry.columns!.cvTop)).toBeLessThanOrEqual(1);
    expect(geometry.cvPaper!.aspectRatio).toBe("auto");
    expect(geometry.cvPaper!.height).toBeLessThan(geometry.viewportHeight * 0.7);
  } else {
    expect(geometry.cv!.height).toBeGreaterThan(0);
  }
}

// #257: the front door hands off here the moment intent is known, so the confirmation sentence
// keeps a persistent home on this screen — and stays absent for a session with no intent yet.
test("the front-door confirmation keeps a persistent home on the discovery screen", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await page.route("**/api/sessions/me/intent", (route) =>
    route.fulfill({
      json: {
        intent: {
          targetRole: "Delivery lead",
          searchAreas: [
            { text: "hk", marketKey: "hk", statedAt: "2026-08-20T00:00:00Z", market: "Hong Kong", label: "Hong Kong" },
          ],
        },
        missing: [],
        checkpoint: "intent_known",
        refused: [],
        coverage: [],
        areaVocabulary: [],
      },
    }),
  );
  await page.goto("/discovery");
  await expect(page.locator(".intent-context")).toHaveText("We’ll look for Delivery lead in Hong Kong.");
});

test("no intent yet: the discovery screen shows no confirmation line", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await page.route("**/api/sessions/me/intent", (route) =>
    route.fulfill({
      json: {
        intent: { targetRole: null, searchAreas: [] },
        missing: ["targetRole", "searchArea"],
        checkpoint: "intent_needed",
        refused: [],
        coverage: [],
        areaVocabulary: [],
      },
    }),
  );
  await page.goto("/discovery");
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.locator(".intent-context")).toHaveCount(0);
});

test("prefers-reduced-motion: the role line still lands without the letter-by-letter", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/discovery"); // a direct load exercises ensureSession()'s own bootstrap too
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("nurse");
  await page.getByRole("button", { name: "That's me" }).click();
  // #339: the live region now announces the line alone (no countdown after it), so the CV's own
  // line is named directly.
  await expect(page.locator(".cv-role")).toHaveText("IT Project Manager");
});


test("every discovery question state fits fluidly across phone, tablet and desktop", async ({ page }, testInfo) => {
  await stubDiscovery(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 2048, height: 1118 },
  ]) {
    await page.setViewportSize(viewport);

    for (const state of [BEFORE_START, AFTER_START]) {
      current = state;
      await page.goto("/discovery");
      await expect(page.locator(".discovery .ask")).toBeVisible();
      await expectDiscoveryFitsViewport(page);
      if (process.env.CAPTURE_DISCOVERY_LAYOUT && state === AFTER_START) {
        await page.screenshot({
          path: testInfo.outputPath(`after-start-${viewport.width}x${viewport.height}.png`),
          fullPage: true,
        });
      }
    }

    current = BEFORE_START;
    await page.goto("/discovery");
    await page
      .getByRole("textbox", { name: "What kind of job are you going for?" })
      .fill("IT project manager in Paris");
    await expect(page.getByText("same kind of job")).toBeVisible();
    await expectDiscoveryFitsViewport(page);
  }
});

// #339 AC: no countdown anywhere in the journey — from question 1 to the hand-off — and no section
// rail it used to sit on.
test("no countdown and no progress rail appear anywhere in the journey", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  const noCountdown = async () => {
    await expect(page.getByText(/answers? until your next jobs/i)).toHaveCount(0);
    await expect(page.locator(".discovery .countdown, .discovery .rail")).toHaveCount(0);
  };

  await page.goto("/discovery");
  await noCountdown();
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page.locator(".discovery .handoff")).toBeVisible();
  await noCountdown();
});

// #386: the hand-off no longer says "That's all I need to ask." to someone asked one question; it
// says the search is set and what comes next. No completion badge, no question.
test("question 1 answered: the ask dock shows the hand-off and what comes next, not a completion badge", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();

  const handoff = page.locator(".discovery .handoff");
  await expect(handoff.locator(".q")).toHaveText("Your search is set.");
  await expect(handoff.locator(".sub")).toHaveText("Now I'll line these jobs up against everything you told me.");
  await expect(handoff).not.toContainText("That's all I need to ask");
  await expect(page.locator(".discovery .opts, .discovery .notice")).toHaveCount(0);
  await expectDiscoveryFitsViewport(page);
  await expect(page.getByText(/100%|done|complete/i)).toHaveCount(0);
});

// #25: the gate hands off to the /deck reveal instead of dead-ending on the placeholder.
test("question 1 answered with no CV to check: Continue goes to the /deck reveal, announcing once", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  // Prior art: deck.spec.ts's GET /onboarding/cards shape — one card is enough to drive the reveal.
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({
      json: {
        stage: "deck",
        cards: [
          {
            adId: "ad-1",
            title: "IT Project Manager",
            company: "Acme",
            place: "Paris",
            salary: null,
            pattern: null,
            matchPct: 82,
            bubble: { hit: "You match on delivery.", open: "" },
            fit: [],
            dontYet: [],
            askedClosed: [],
            adExcerpt: "excerpt",
          },
        ],
      },
    });
  });

  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();

  // AC2: the discovery side never announces the hand-off itself — only /deck's own entry effect
  // does, once.
  const handoff = page.locator(".discovery .handoff");
  await expect(handoff.locator(".go")).toBeVisible();
  await expect(page.locator(".discovery .sr-only")).not.toContainText("Your search is set.");

  // #376: the hand-off waits for the person; Continue takes them to the reveal — the single place
  // focus + the polite announce land.
  await handoff.locator(".go").click();
  await page.waitForURL("/deck");
  const heading = page.getByRole("heading", { name: /matched you/ });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveText("1 job just matched you");
});


// #338 (ADR-0016 clause 6): a brought CV is reviewed before any job is shown. The server says so on
// the state, and the handoff lands on the review instead of the deck — since #377, the profile's
// check mode (ADR-0018), opening at Your details. #376 (ADR-0018 clause 8): nothing is asked between
// question 1 and check mode — the server answers question 1 with the hand-off itself.
test("#376: after question 1 nothing is asked — the hand-off holds with the promise, and Continue goes to check mode", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  // The server's real answer to question 1 now: the hand-off, no question.
  await page.route("**/api/onboarding/discovery/start", async (route) => {
    current = { ...AFTER_START, reviewPending: true };
    await route.fulfill({ json: current });
  });
  const answers: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/onboarding/discovery/answer")) answers.push(r.url());
  });
  await page.route("**/api/review", async (route) => {
    await route.fulfill({
      json: {
        completed: false,
        letterhead: { name: { value: "Jane Doe", origin: "read" }, title: null, email: null, phone: null, location: null },
        conflict: null,
        progress: null,
        unchecked: false,
        sections: [],
        workRights: [],
        languages: [],
        languageOptions: [],
      },
    });
  });

  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();
  // The hand-off holds (tech-lead decision on #376): no question, and the promise stays readable —
  // it no longer moves on by itself (the old bridge left after 0.8 s).
  const handoff = page.locator(".discovery .handoff");
  await expect(handoff.locator(".go")).toBeVisible();
  await expect(page.locator(".discovery .opts")).toHaveCount(0);
  await expect(page.locator(".discovery")).toContainText("142");
  await expect(handoff.locator(".sub")).toHaveText("Next, check how I read your CV. Your jobs open when you finish.");
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).toBe("/discovery");

  await handoff.locator(".go").click();
  await page.waitForURL("/profile/check");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your details");
  expect(answers).toEqual([]); // nothing was asked, so nothing was answered
});
