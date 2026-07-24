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
    current = AFTER_ANSWER;
    await route.fulfill({ json: current });
  });
  await page.route("**/api/onboarding/discovery", async (route) => {
    await route.fulfill({ json: current });
  });
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
  await expect(page.getByRole("button", { name: "Project Manager" })).toBeVisible();

  await page.getByRole("button", { name: "That's me" }).click();

  // The promise appears, carrying the visitor's city (count + sentence render in sibling nodes,
  // so check the shared status region's combined text rather than one exact string).
  const promise = page.getByRole("status");
  await expect(promise).toContainText("142");
  await expect(promise).toContainText("project manager jobs are open in Paris right now.");

  // The role lead line lands on the CV, then the countdown shows.
  await expect(page.getByText("IT Project Manager")).toBeVisible();
  await expect(page.getByText("3 answers until your next jobs")).toBeVisible();

  // Answer the floor question — a line types into its section, and the countdown decrements.
  await page.getByRole("button", { name: "5-10 years" }).click();
  await expect(page.getByText("5 to 10 years of experience as a project manager.")).toBeVisible();
  await expect(page.getByText("2 answers until your next jobs")).toBeVisible();

  // Reload: both answers resume, rendered statically — never re-typed. A buggy re-animation of
  // two lines in sequence would take >2s to finish; a tight budget here is a real regression
  // signal, not a flaky one.
  await page.reload();
  await expect(page.getByText("IT Project Manager")).toBeVisible();
  await expect(page.getByText("5 to 10 years of experience as a project manager.")).toBeVisible({
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
  await expect(page.getByText("IT Project Manager")).toBeVisible();
});
