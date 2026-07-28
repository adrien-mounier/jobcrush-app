import { expect, test, type Page } from "@playwright/test";
import type { CvSection, DiscoveryState } from "../lib/api";

// #16 discovery (screen 1a) end to end: front door -> discovery, Q1 -> the promise -> a
// tap-first floor answer types a CV line and advances the countdown -> reload resumes
// statically. The backend for these four endpoints may not be wired when this runs (the
// ticket's own note), so every /api/onboarding/discovery* call is stubbed at the route layer to
// the pinned DiscoveryState shape — deterministic and self-contained. Session bootstrap
// (/api/sessions/*) and the front door itself hit the real API, matching front-door.spec.ts's
// own assumption (only the discovery-specific backend is unwired, not the whole API).

const RAIL_ZERO: Record<CvSection, number> = { summary: 0, experience: 0, skills: 0, education: 0 };

const Q_YEARS = {
  itemId: "years",
  question: "Roughly how long have you been doing it?",
  options: ["Under 2 years", "2-5 years", "5-10 years", "10+ years"],
  cvSection: "experience" as const,
};
const Q_BUDGET = {
  itemId: "budget",
  question: "Have you managed a budget?",
  options: ["Yes", "No"],
  cvSection: "experience" as const,
};
const Q_STAKEHOLDER = {
  itemId: "stakeholder",
  question: "Have you reported to senior stakeholders?",
  options: ["Yes", "No"],
  cvSection: "experience" as const,
};
const Q_HEADLINE = {
  itemId: "headline",
  question: "What should employers notice first?",
  options: [],
  cvSection: "summary" as const,
};

const BEFORE_START: DiscoveryState = {
  stage: "discovery",
  role: null,
  family: null,
  city: null,
  promise: null,
  questions: [],
  railFill: RAIL_ZERO,
  essentialRemaining: 3,
  cvLines: [],
  factCount: 0,
};

const AFTER_START: DiscoveryState = {
  stage: "discovery",
  role: "IT Project Manager",
  family: "project manager",
  city: "Paris",
  promise: { family: "project manager", city: "Paris", count: 142 },
  questions: [Q_YEARS, Q_BUDGET],
  railFill: RAIL_ZERO,
  essentialRemaining: 3,
  cvLines: [{ itemId: "role", section: "summary", text: "IT Project Manager" }],
  factCount: 1,
};

const AFTER_ANSWER: DiscoveryState = {
  ...AFTER_START,
  questions: [Q_BUDGET],
  railFill: { ...RAIL_ZERO, experience: 0.34 },
  essentialRemaining: 2,
  cvLines: [
    ...AFTER_START.cvLines,
    { itemId: "years", section: "experience", text: "5 to 10 years of experience as a project manager." },
  ],
  factCount: 2,
};

// #18: re-answering "years" with a different option is a correction (same itemId, new text) —
// the same /answer endpoint, now idempotent server-side. #17: factCount is inherited, unchanged —
// a correction flips one record in place, it doesn't grow the count (badge-ui-spec.md §12.1).
const AFTER_CORRECTION: DiscoveryState = {
  ...AFTER_ANSWER,
  cvLines: [
    AFTER_ANSWER.cvLines[0],
    { itemId: "years", section: "experience", text: "10+ years of experience as a project manager." },
  ],
};

// #18: a bare "no" on "budget" — no new line, that question is gone, the countdown still advances,
// but an essential item remains. A "no" never empties `questions` while `essentialRemaining > 0`
// (that only happens when the last essential is answered and the gate flips stage to "deck"), so the
// next question stays in the dock with the C15 undo notice above it — exactly what the real API emits.
// #17: factCount still grows — a "no" is a recorded negative, and the badge is what pays for it now
// (badge-ui-spec.md §"the 'no' finally pays") even though no CV line types.
const AFTER_NO: DiscoveryState = {
  ...AFTER_ANSWER,
  questions: [Q_STAKEHOLDER],
  essentialRemaining: 1,
  factCount: 3,
};
const AFTER_FREE_TEXT: DiscoveryState = {
  ...AFTER_ANSWER,
  questions: [Q_HEADLINE],
};

// #18: "budget" was the last essential item — the server flips the stage, no new line either way.
const AFTER_ESSENTIAL_DONE: DiscoveryState = {
  ...AFTER_ANSWER,
  stage: "deck",
  questions: [],
  essentialRemaining: 0,
  factCount: 3,
};

// Mutated by the /start and /answer stubs below so a later GET (including one after a reload)
// resumes from wherever the flow last landed.
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
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    // #18: this same endpoint now also carries in-flow corrections (idempotent re-answer) — branch
    // on what was posted so one stub drives the fresh-answer, correction, "no", and
    // essential-band-done fixtures below.
    const { itemId, answer } = route.request().postDataJSON() as { itemId: string; answer: string };
    if (itemId === "years" && answer === "10+ years") {
      current = AFTER_CORRECTION;
    } else if (itemId === "budget" && answer === "Yes") {
      current = AFTER_ESSENTIAL_DONE;
    } else if (itemId === "budget" && /^no$/i.test(answer)) {
      current = AFTER_NO;
    } else {
      current = AFTER_ANSWER;
    }
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

test("discovery core loop: Q1 -> promise -> a floor answer types a line and advances progress; reload resumes", async ({
  page,
}) => {
  current = BEFORE_START;
  await stubDiscovery(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Ready?" }).click({ timeout: 10_000 });
  await page.waitForURL(/\/discovery/);

  // Q1: the CV skeleton is visible and empty — headings only, no lines.
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Experience" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Education" })).toBeVisible();

  const roleBox = page.getByRole("textbox", { name: "What kind of job are you going for?" });
  await expect(roleBox).toBeFocused();

  // An unmatched title is accepted without any "not found".
  await roleBox.fill("zzz consultant");
  await expect(page.getByRole("button", { name: "That's me" })).toBeEnabled();
  await expect(page.getByText(/not found/i)).toHaveCount(0);
  await expect(page.getByText("same kind of job")).toHaveCount(0);

  // Typing a real title offers the whole family under the "same kind of job" label.
  await roleBox.fill("IT project manager in Paris");
  await expect(page.getByText("same kind of job")).toBeVisible();
  await expect(page.getByRole("button", { name: "Project Manager", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "That's me" }).click();

  // The promise appears, carrying the visitor's city (count + sentence render in sibling nodes,
  // so check the shared status region's combined text rather than one exact string).
  const promise = page.getByRole("status");
  await expect(promise).toContainText("142");
  await expect(promise).toContainText("project manager jobs are open in Paris right now.");

  // The role lead line lands on the CV, then the countdown shows.
  await expect(page.getByText("IT Project Manager", { exact: true })).toBeVisible();
  await expect(page.getByText("3 answers until your next jobs", { exact: true })).toBeVisible();

  // Answer the floor question — a line types into its section, and the countdown decrements.
  await page.getByRole("button", { name: "5-10 years" }).click();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toBeVisible();
  await expect(page.getByText("2 answers until your next jobs", { exact: true })).toBeVisible();

  // Reload: both answers resume, rendered statically — never re-typed. A buggy re-animation of
  // two lines in sequence would take >2s to finish; a tight budget here is a real regression
  // signal, not a flaky one.
  await page.reload();
  await expect(page.getByText("IT Project Manager", { exact: true })).toBeVisible();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toBeVisible({
    timeout: 1200,
  });
});

test("prefers-reduced-motion: the role line still lands without the letter-by-letter", async ({ page }) => {
  current = BEFORE_START;
  await stubDiscovery(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/discovery"); // a direct load exercises ensureSession()'s own bootstrap too
  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("nurse");
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page.getByText("IT Project Manager", { exact: true })).toBeVisible();
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

    for (const state of [BEFORE_START, AFTER_START, AFTER_ANSWER, AFTER_NO, AFTER_FREE_TEXT]) {
      current = state;
      await page.goto("/discovery");
      await expect(page.locator(".discovery .ask")).toBeVisible();
      await expectDiscoveryFitsViewport(page);
      if (process.env.CAPTURE_DISCOVERY_LAYOUT && state === AFTER_ANSWER) {
        await page.screenshot({
          path: testInfo.outputPath(`after-answer-${viewport.width}x${viewport.height}.png`),
          fullPage: true,
        });
      }
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

// #18 discovery (screen 1b): in-flow correction, the bare-"no" undo, and the deck handoff — all
// three net-new interactions this ticket adds on top of #16's core loop.

test("tapping an answered CV line and picking a different option updates it in place", async ({ page }) => {
  current = AFTER_START;
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "5-10 years" }).click();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toBeVisible();

  // The line is a real, named control — tapping it opens the re-ask in place of the next question.
  const cvLine = page.getByRole("button", { name: /Fix this line/i });
  await cvLine.click();
  await expect(page.getByText("Change your answer.")).toBeVisible();
  await expectDiscoveryFitsViewport(page);

  // #24: cancelling via Esc returns keyboard focus to the corrected line, not the next question.
  await page.keyboard.press("Escape");
  await expect(cvLine).toBeFocused();

  // #24: same for "Leave it as is".
  await cvLine.click();
  await page.getByRole("button", { name: "Leave it as is" }).click();
  await expect(cvLine).toBeFocused();

  // #24: committing a correction also returns focus to the (re-typed) line.
  await cvLine.click();
  await page.getByRole("button", { name: "10+ years" }).click();
  await expect(page.getByText("10+ years of experience as a project manager.", { exact: true })).toBeVisible();
  await expect(page.getByText("5 to 10 years of experience as a project manager.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Fix this line/i })).toBeFocused();
});

test('answering "No" gives quiet feedback and an undo, never a failure', async ({ page }) => {
  current = AFTER_ANSWER; // "years" already answered; "budget" (Yes/No) is the live next question
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "No", exact: true }).click();

  await expect(page.locator(".discovery .notice")).toContainText("Noted — one less thing to ask.");
  await expectDiscoveryFitsViewport(page);
  const fixThat = page.getByRole("button", { name: "Fix that?" });
  await expect(fixThat).toBeVisible();
  await expect(page.getByText("Have you managed a budget?")).toHaveCount(0);

  // #24: cancelling the bare-"no" fix via Esc returns focus to "Fix that?" (no CV line exists to
  // return to), not the next question.
  await fixThat.click();
  await expect(page.getByText("Change your answer.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fixThat).toBeFocused();
});

test("the essential band done: the ask dock shows the handoff, not a completion badge", async ({ page }) => {
  current = AFTER_ANSWER;
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  await expect(page.getByText("Now I'll line these jobs up against everything you told me.", { exact: true })).toBeVisible();
  await expectDiscoveryFitsViewport(page);
  await expect(page.getByText(/100%|done|complete/i)).toHaveCount(0);
});

// #25: the gate now hands off to the /deck reveal instead of dead-ending on the placeholder.
test("the essential band done: discovery navigates to the /deck reveal, announcing once", async ({ page }) => {
  current = AFTER_ANSWER;
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
  await page.getByRole("button", { name: "Yes", exact: true }).click();

  // The #18 handoff still shows first, as a brief bridge — dropping it would break the moment.
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  // AC2: the discovery side never announces the deck handoff itself — only /deck's own entry
  // effect does, once. If this ever regressed to double-announcing, this live region would carry
  // the C19/C20 text too.
  await expect(page.locator(".discovery .sr-only")).not.toContainText("That's all I need to ask.");

  // Then it navigates to the reveal — the single place focus + the polite announce land.
  await page.waitForURL("/deck");
  const heading = page.getByRole("heading", { name: /matched you/ });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveText("1 job just matched you");
});
