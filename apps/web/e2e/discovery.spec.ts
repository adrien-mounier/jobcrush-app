import { expect, test, type Page } from "@playwright/test";
import type { DiscoveryQuestion, DiscoveryState } from "../lib/api";

// #16 discovery (screen 1a) end to end: front door -> discovery, Q1 -> the promise -> the
// eligibility questions -> the handoff. Every /api/onboarding/discovery* call is stubbed at the
// route layer to the pinned DiscoveryState shape — deterministic and self-contained. Session
// bootstrap (/api/sessions/*) and the front door itself hit the real API.
//
// #339: discovery asks question 1, then work rights once per chosen market and languages once —
// no floor question, no countdown, no section rail. "Ask me later" stores nothing, so the stub below
// answers a decline exactly as the server does: with the same questions still open.

// #106: eligibility questions — copy is verbatim from the #106 design spec's copy table (the
// contract the backend implements against too), so these fixtures double as a check that the client
// renders the wire strings as-is rather than composing its own `.q`/options.
const workRights = (itemId: string, place: string): DiscoveryQuestion => ({
  itemId,
  question: `Can you already work in ${place} without visa sponsorship?`,
  options: ["Yes — no sponsorship needed", "Not yet — I'd need sponsorship", "Ask me later"],
  cvSection: "experience",
  eligibility: { dimension: "work-rights", familyId: itemId, scopeLabel: null, declineOption: "Ask me later" },
});
const Q_WR_PARIS = workRights("eligibility-work-rights-france", "France");
const Q_WR_HK = workRights("eligibility-work-rights-hong-kong", "Hong Kong");

// #336: the languages question pre-ticks the CV's languages at Native, Fluent or Professional; any
// other level shows unticked with the CV's own word; a language with no level shows unticked and
// bare.
const Q_ELIG_LANGUAGES: DiscoveryQuestion = {
  itemId: "eligibility-languages",
  question: "Which languages do you speak? Start typing — I'll suggest as you go.",
  consequence: "Nothing you leave out counts against you.",
  options: ["English", "Mandarin", "Cantonese", "Vietnamese", "Ask me later"],
  multiSelect: true,
  typeAhead: true,
  cvSection: "skills",
  eligibility: { dimension: "language", familyId: "", scopeLabel: null, declineOption: "Ask me later" },
  cvLanguages: [
    { language: "Polish", level: "Native", preTicked: true },
    { language: "English", level: "Fluent", preTicked: true },
    { language: "German", level: "Professional working proficiency", preTicked: true },
    { language: "French", level: "Conversational", preTicked: false },
    { language: "Italian", level: null, preTicked: false },
  ],
};

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

const AFTER_START: DiscoveryState = {
  stage: "discovery",
  role: "IT Project Manager",
  family: "project manager",
  city: null,
  promise: { count: 142 },
  questions: [Q_WR_PARIS, Q_WR_HK],
  cvLines: [{ itemId: "role", section: "summary", text: "IT Project Manager" }],
  factCount: 1,
};
const WITH_LANGUAGES: DiscoveryState = { ...AFTER_START, questions: [Q_ELIG_LANGUAGES] };

// The server's own rule, stubbed: a real answer closes its question, "Ask me later" closes nothing,
// and the stage turns "deck" once no question is open.
function answered(state: DiscoveryState, itemId: string, answer: string | undefined): DiscoveryState {
  if (answer === "Ask me later") return state;
  const questions = state.questions.filter((q) => q.itemId !== itemId);
  return { ...state, questions, stage: questions.length === 0 ? "deck" : "discovery" };
}

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
    const { itemId, answer } = route.request().postDataJSON() as { itemId: string; answer?: string };
    current = answered(current, itemId, answer);
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

    // #106: the work-rights question carries the longest option in the set ("Not yet — I'd need
    // sponsorship"), the fixture the design spec calls out for the 360-ish px floor (§8).
    for (const state of [BEFORE_START, AFTER_START, WITH_LANGUAGES]) {
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

// #339 AC: no countdown anywhere in the journey — from question 1, through every eligibility
// question and a decline, to the handoff — and no section rail it used to sit on.
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
  await expect(page.getByText(Q_WR_PARIS.question, { exact: true })).toBeVisible();
  await noCountdown();
  await page.getByRole("button", { name: "Ask me later", exact: true }).click();
  await expect(page.getByText(Q_WR_HK.question, { exact: true })).toBeVisible();
  await noCountdown();
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  await noCountdown();
});

test("an eligibility question states its scope in the question itself, offers a first-class decline, and a real answer confirms without touching the CV", async ({
  page,
}) => {
  current = AFTER_START;
  await stubDiscovery(page);

  await page.goto("/discovery");

  // The scope is tellable from the question alone (design spec §3) — not just a sub-line a user
  // could skim past.
  await expect(page.getByText(Q_WR_PARIS.question, { exact: true })).toBeVisible();
  await expect(page.getByText("Either answer is useful — it just changes which jobs I show you.")).toBeVisible();

  // Tap-first: no free-text box on this question, and the decline is a real option, last in order.
  const options = page.locator(".discovery .opts button");
  await expect(options).toHaveCount(3);
  await expect(options.last()).toHaveText("Ask me later");
  await expect(page.locator(".discovery textarea, .discovery .freetext")).toHaveCount(0);

  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  // A real answer reads exactly like any other — a locked-in confirmation, never a punishment —
  // and no CV line was added for it.
  await expect(page.locator(".discovery .notice")).toContainText(
    "Locked in — I'll use that on every job, so I won't ask again.",
  );
  await expect(page.getByRole("button", { name: "Fix that?" })).toBeVisible();
  await expect(page.locator(".discovery .cv-line")).toHaveCount(0);
  await expectDiscoveryFitsViewport(page);
});

test("declining an eligibility question is informative, never a failure, and stays correctable", async ({ page }) => {
  current = AFTER_START; // France is live; Hong Kong is next
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Ask me later", exact: true }).click();

  await expect(page.locator(".discovery .notice")).toContainText("No problem — I'll ask again when a job needs it.");
  const answerNow = page.getByRole("button", { name: "Answer it now" });
  await expect(answerNow).toBeVisible();
  await expect(page.locator(".err")).toHaveCount(0); // never rendered as an error
  // The server still lists France (nothing was stored), and the screen moves on anyway.
  await expect(page.getByText(Q_WR_HK.question, { exact: true })).toBeVisible();
  await expect(page.getByText(Q_WR_PARIS.question, { exact: true })).toHaveCount(0);
  await expectDiscoveryFitsViewport(page);

  // Declining is correctable exactly like a real answer (design spec §5.4) — Esc returns focus to
  // its own fix button, since there is no CV line to return to.
  await answerNow.click();
  await expect(page.getByText("Change your answer.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(answerNow).toBeFocused();
});

// #339: "Ask me later" stores nothing, so the question it put off is still open on the server. The
// visit moves past it and hands off once nothing else is open; the next visit asks it again.
test('"Ask me later" moves this visit on, and the next visit asks again', async ({ page }) => {
  current = AFTER_START;
  await stubDiscovery(page);
  await page.route("**/api/onboarding/cards", (route) => route.fulfill({ json: { stage: "deck", cards: [] } }));

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Ask me later", exact: true }).click();
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  expect(current.questions.map((q) => q.itemId)).toEqual([Q_WR_PARIS.itemId]);

  await page.goto("/discovery");
  await expect(page.getByText(Q_WR_PARIS.question, { exact: true })).toBeVisible();
});

test("fixing an answered eligibility question re-opens it with the previous choice already picked", async ({
  page,
}) => {
  current = AFTER_START;
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();
  const fixThat = page.getByRole("button", { name: "Fix that?" });
  await expect(fixThat).toBeVisible();

  await fixThat.click();
  await expect(page.getByText("Change your answer.")).toBeVisible();
  // design spec §5.4 point 2: the re-ask opens with the current answer already picked, not blank.
  await expect(page.getByRole("button", { name: "Yes — no sponsorship needed" })).toHaveClass(/picked/);

  await page.keyboard.press("Escape");
  await expect(fixThat).toBeFocused();

  // Committing a different answer updates the notice and returns focus to the fix button (#24).
  await fixThat.click();
  await page.getByRole("button", { name: "Not yet — I'd need sponsorship" }).click();
  await expect(page.locator(".discovery .notice")).toContainText(
    "Locked in — I'll use that on every job, so I won't ask again.",
  );
  await expect(page.getByRole("button", { name: "Fix that?" })).toBeFocused();
});

test("the last question answered: the ask dock shows the handoff, not a completion badge", async ({ page }) => {
  current = { ...AFTER_START, questions: [Q_WR_HK] };
  await stubDiscovery(page);

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  await expect(page.getByText("Now I'll line these jobs up against everything you told me.", { exact: true })).toBeVisible();
  await expectDiscoveryFitsViewport(page);
  await expect(page.getByText(/100%|done|complete/i)).toHaveCount(0);
});

// #25: the gate hands off to the /deck reveal instead of dead-ending on the placeholder.
test("the last question answered: discovery navigates to the /deck reveal, announcing once", async ({ page }) => {
  current = { ...AFTER_START, questions: [Q_WR_HK] };
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
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  // The #18 handoff still shows first, as a brief bridge — dropping it would break the moment.
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  // AC2: the discovery side never announces the deck handoff itself — only /deck's own entry
  // effect does, once.
  await expect(page.locator(".discovery .sr-only")).not.toContainText("That's all I need to ask.");

  // Then it navigates to the reveal — the single place focus + the polite announce land.
  await page.waitForURL("/deck");
  const heading = page.getByRole("heading", { name: /matched you/ });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator('[aria-live="polite"]')).toHaveText("1 job just matched you");
});

// #338 (ADR-0016 clause 6): a brought CV is reviewed before any job is shown. The server says so on
// the state, and the same handoff moment lands on "Your CV, reviewed" instead of the deck.
test("the last question answered with a CV to review: discovery hands off to the review", async ({ page }) => {
  current = { ...AFTER_START, questions: [Q_WR_HK], reviewPending: true };
  await stubDiscovery(page);
  await page.route("**/api/review", async (route) => {
    await route.fulfill({
      json: { completed: false, letterhead: { header: "Jane Doe", phone: null, email: null }, conflict: null, sections: [] },
    });
  });

  await page.goto("/discovery");
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
  await page.waitForURL("/review");
  await expect(page.getByRole("heading", { name: "Your CV, reviewed" })).toBeVisible();
});

// #336: what the person submits — unticks and additions included — is exactly what is posted.
test("the languages question pre-ticks the CV's working languages, and what is submitted is what the person chose", async ({
  page,
}) => {
  current = WITH_LANGUAGES;
  await stubDiscovery(page);
  const posted: unknown[] = [];
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...AFTER_START, stage: "deck", questions: [] } });
  });

  await page.goto("/discovery");
  const box = (name: string) => page.getByRole("checkbox", { name });
  for (const name of ["Polish", "English", "German"]) await expect(box(name)).toBeChecked();
  for (const name of ["French", "Italian"]) await expect(box(name)).not.toBeChecked();
  await expect(page.locator(".opt.check", { hasText: "French" })).toContainText("Conversational");
  await expect(page.locator(".opt.check", { hasText: "Italian" }).locator(".state")).toHaveCount(0);
  // No language is shown twice: English is a CV tick-box, never also a chip.
  await expect(page.locator(".lang-typeahead .chips")).toHaveCount(0);

  await box("German").uncheck();
  await page.locator("#lang-input").fill("Swedish");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "That's all of them" }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({ itemId: "eligibility-languages", answers: ["Polish", "English", "Swedish"] });
});

test('"Ask me later" on the languages question posts the decline, never the pre-ticked languages', async ({ page }) => {
  current = WITH_LANGUAGES;
  await stubDiscovery(page);
  const posted: unknown[] = [];
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: WITH_LANGUAGES }); // nothing stored — the question is still open
  });

  await page.goto("/discovery");
  await expect(page.getByRole("checkbox", { name: /^Polish\b/ })).toBeChecked();
  await page.getByRole("button", { name: /^Ask me later/ }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({ itemId: "eligibility-languages", answer: "Ask me later" });
  // #339: it was the last open question for this visit, so the screen hands off.
  await expect(page.getByText("That's all I need to ask.", { exact: true })).toBeVisible();
});
