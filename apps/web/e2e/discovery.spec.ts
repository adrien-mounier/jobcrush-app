import { expect, test, type Page } from "@playwright/test";
import type { DiscoveryState } from "../lib/api";

// #16 discovery (screen 1a) end to end: front door -> discovery, Q1 -> the job count -> on by itself (#392).
// Every /api/onboarding/discovery* call is stubbed at the route layer to the pinned DiscoveryState
// shape — deterministic and self-contained. Session bootstrap (/api/sessions/*) and the front door
// itself hit the real API.
//
// #339: no floor question, no countdown, no section rail. #376 (ADR-0018 clause 8): the server asks
// nothing after question 1 — work rights and languages are answered in the profile's check mode —
// and #386 removed this screen's question UI with the tests that pinned it (the eligibility asks,
// "Ask me later", their corrections, the languages multi-select): the server answers question 1
// with the hand-off itself, which is the shape every test below drives. #392: that hand-off is no
// longer a screen — the count ticks up in the wait and the flow moves on by itself.

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
  await recordShownCounts(page);

  await page.goto("/discovery"); // a direct load exercises ensureSession()'s own bootstrap too
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("nurse");
  await page.getByRole("button", { name: "That's me" }).click();
  // #339: the live region announces the role line alone (no countdown after it). #392: the screen
  // turns into the wait as soon as the line lands, so the announce is what is left to read.
  await expect(page.locator(".discovery > .sr-only")).toHaveText("IT Project Manager");
  // #392: the job count does not tick up under reduced motion — the only number ever shown is the count.
  await expect(page.locator(".promise .n")).toHaveText("142");
  expect(await page.evaluate(() => (window as unknown as { shownCounts: string[] }).shownCounts)).toEqual(["142"]);
});

// #392: every number the count slot ever shows, in order — recorded in the page, so the test never
// races the ~0.9 s tick.
async function recordShownCounts(page: Page) {
  await page.addInitScript(() => {
    const shown: string[] = ((window as unknown as { shownCounts: string[] }).shownCounts = []);
    new MutationObserver(() => {
      const text = document.querySelector(".promise .n")?.textContent;
      if (text && /^\d+$/.test(text) && text !== shown.at(-1)) shown.push(text); // not the "···" wait
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

test("#392: the job count ticks up to the real number in the loading box; the old 'new jobs are open' line is gone", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await recordShownCounts(page);
  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();
  const n = page.locator(".promise .n");
  await expect(n).toHaveText("142");
  const shown = (await page.evaluate(() => (window as unknown as { shownCounts: string[] }).shownCounts)).map(Number);
  expect(shown[0]).toBe(0);
  expect(shown.at(-1)).toBe(142);
  expect(shown).toEqual([...shown].sort((a, b) => a - b)); // only ever climbs
  await expect(page.locator(".promise")).toContainText("jobs like yours found.");
  await expect(page.locator(".discovery")).not.toContainText("new jobs are open right now");
  await expect(page.locator(".discovery")).not.toContainText("Keep going and I'll score them against you.");
  // The count stays readable before the flow moves on by itself — no Continue, no "Your search is set."
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.locator(".discovery")).not.toContainText("Your search is set.");
  await page.waitForURL("/deck");
});

test("#392: no count (her search found nothing or could not run) — no number, and the flow moves on at once", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await recordShownCounts(page);
  await page.route("**/api/onboarding/discovery/start", async (route) => {
    current = { ...AFTER_START, promise: null };
    await route.fulfill({ json: current });
  });
  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  const clicked = Date.now();
  await page.getByRole("button", { name: "That's me" }).click();
  await page.waitForURL("/deck");
  expect(Date.now() - clicked).toBeLessThan(2500); // role line types (~0.8 s), but no count hold (0.9 s tick + 1.2 s)
  expect(await page.evaluate(() => (window as unknown as { shownCounts: string[] }).shownCounts)).toEqual([]);
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

    // #392: AFTER_START is no longer a screen of its own — it is the wait, and it moves on.
    for (const state of [BEFORE_START]) {
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

// #339 AC: no countdown anywhere in the journey — from question 1 to the job count — and no section
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
  await expect(page.locator(".promise .n")).toBeVisible();
  await noCountdown();
});

// #386 + #392: question 1 answered — no hand-off copy, no Continue, no completion badge; the count
// is the whole screen until the flow moves on.
test("question 1 answered: no hand-off, no Continue, no completion badge — just the count", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();

  await expect(page.locator(".promise .n")).toBeVisible();
  await expect(page.locator(".discovery .handoff, .discovery .opts, .discovery .notice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByText(/100%|done|complete|That's all I need to ask/i)).toHaveCount(0);
});

// #25: the gate hands off to the /deck reveal instead of dead-ending on the placeholder.
test("question 1 answered with no CV to check: the flow moves on to the /deck reveal by itself, announcing once", async ({ page }) => {
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

  // AC2: the discovery side never announces a hand-off itself — only /deck's own entry effect does,
  // once. #392: no Continue — the count holds, then the reveal is where focus + the announce land.
  await expect(page.locator(".promise .n")).toBeVisible();
  await expect(page.locator(".discovery > .sr-only")).toHaveText("IT Project Manager");
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
test("#376/#392: after question 1 nothing is asked — the count holds, then the flow moves on to check mode by itself", async ({ page }) => {
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
  // #392 (owner, 2026-10-16; supersedes the #376 tech-lead hold): no question, the count lands and
  // stays readable while it ticks and holds, then the flow moves on — no Continue.
  await expect(page.locator(".promise .n")).toHaveText("142");
  const landed = Date.now();
  await expect(page.locator(".discovery .opts")).toHaveCount(0);
  await page.waitForURL("/profile/check");
  expect(Date.now() - landed).toBeGreaterThan(800); // the final number held long enough to read
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your details");
  expect(answers).toEqual([]); // nothing was asked, so nothing was answered
});
