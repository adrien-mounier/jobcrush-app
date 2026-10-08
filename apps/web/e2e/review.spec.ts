import { expect, test, type Page } from "@playwright/test";
import type { CardsResponse, ReviewLine, ReviewState } from "../lib/api";

// #338 "Your CV, reviewed" (layout C — the marked-up CV), route-mocked to the pinned ReviewState
// shape. What it proves on the screen: letterhead first, then each job with its lines as read; an
// untick and a re-tick each send the tap and re-render; the end-date pill asks on the job's own card
// and "Not sure" sends nothing; the conflict pill settles once; the confirm completes the review and
// hands off to the jobs; and the deck sends an unreviewed session here.
// #341 adds the AI's first marks: the progress card while the review runs (an unanswered job greyed
// and "still being checked", the confirm locked), the fix — corrected words green on the paper,
// original → corrected with Undo / Use fix in the sheet — and the amber suggestion band with its
// reason, including fixes outside the jobs (summary, skills, education).
// #342 adds the drafted lines: unticked dashed boxes at the end of their job with the flags inline
// and the source under each without a tap; the + and the sheet's Tick send the tick and the box
// becomes an ordinary bullet with a "new" tag; Edit in the sheet stores the person's wording before
// the tick; a ticked draft unticks like any line; a job with nothing missing wears the COMPLETE ✓
// stamp; a job in no family shows neither.
// #343 adds the word choices: a vague phrase in a draft wears a dotted underline; a tap opens its
// choices (CV first, then typical, each tagged, and the person's own words) without a request; a pick
// or typed words replace the phrase through the draft's edit door, and the ticked line keeps them.

const CONTACT_PHONE = { value: "+33 6 00 00 00 00", origin: "read" as const };
const CONTACT_EMAIL = { value: "jane.doe@example.com", origin: "read" as const };

const line = (id: string, text: string, over: Partial<ReviewLine> = {}): ReviewLine => ({
  id,
  text,
  state: "ticked",
  fix: null,
  suggestion: null,
  draft: null,
  ...over,
});

const REVIEW: ReviewState = {
  completed: false,
  letterhead: { header: "Jane Doe\nParis, France", phone: CONTACT_PHONE, email: CONTACT_EMAIL },
  conflict: { fieldId: "city", question: "City: your CV says Paris and also Lyon. Which one is right?", values: ["Paris", "Lyon"] },
  progress: null,
  sections: [
    { tag: "profile", heading: "Professional Summary", lines: [line("p1", "Delivery-accountable project manager.")] },
    {
      tag: "experience",
      heading: "Professional Experience",
      jobs: [
        {
          id: "nrg",
          blockId: "nrg",
          title: "IT Project Manager",
          employer: "Nordic Retail Group",
          dates: { start: "Mar 2021", end: "now" },
          endDateQuestion: null,
          checking: false,
          family: null,
          complete: false,
          lines: [line("nrg-1", "Led the checkout replatform."), line("nrg-2", "Managed a budget of EUR 1.2M across 3 vendor teams.")],
        },
        {
          id: "bsh",
          blockId: "bsh",
          title: "Project Coordinator",
          employer: "Baltic Software House",
          dates: { start: "Jun 2017", end: null },
          endDateQuestion: "When did you leave Baltic Software House?",
          checking: false,
          family: null,
          complete: false,
          lines: [line("bsh-1", "Coordinated releases for 4 agile squads.")],
        },
      ],
    },
    { tag: "skill", heading: "Skills", lines: [line("s1", "Jira, MS Project.")] },
    { tag: "cert", heading: "Certifications", lines: [] },
    { tag: "edu", heading: "Education", lines: [line("e1", "MSc, University of Warsaw.")] },
    { tag: "lang", heading: "Languages", lines: [] },
  ],
};

const jobsOf = (state: ReviewState) => (state.sections[1] as Extract<ReviewState["sections"][number], { tag: "experience" }>).jobs;
// #341: the same paper with the review's marks on it.
const TYPO = "Managed a budget of EUR 1.2M accross 3 vendor teams.";
const FIXED = "Managed a budget of EUR 1.2M across 3 vendor teams.";
const REASON = "States an aim and no delivered result.";
const AIM = "Set up a release calendar intended to cut slippage.";
function marked(over: Partial<ReviewState> = {}): ReviewState {
  return {
    ...REVIEW,
    sections: [
      { tag: "profile", heading: "Professional Summary", lines: [line("p1", "Delivery-accountable project manager.", { fix: { original: "Delivery-acountable project manager.", corrected: "Delivery-accountable project manager.", applied: true } })] },
      {
        tag: "experience",
        heading: "Professional Experience",
        jobs: [
          {
            ...jobsOf(REVIEW)[0]!,
            lines: [line("nrg-1", "Led the checkout replatform."), line("nrg-2", FIXED, { fix: { original: TYPO, corrected: FIXED, applied: true } })],
          },
          {
            ...jobsOf(REVIEW)[1]!,
            lines: [line("bsh-1", "Coordinated releases for 4 agile squads."), line("bsh-2", AIM, { suggestion: { kind: "aim-without-result", reason: REASON } })],
          },
        ],
      },
      { tag: "skill", heading: "Skills", lines: [line("s1", "Jira, MS Project.", { fix: { original: "Jira, MS Projcet.", corrected: "Jira, MS Project.", applied: true } })] },
      { tag: "cert", heading: "Certifications", lines: [] },
      { tag: "edu", heading: "Education", lines: [line("e1", "MSc, University of Warsaw.", { fix: { original: "MSc, University of Warsaw", corrected: "MSc, University of Warsaw.", applied: true } })] },
      { tag: "lang", heading: "Languages", lines: [] },
    ],
    ...over,
  };
}

// #342: the same paper with three drafted lines at the end of the placed job, and none on the other.
const MUST_HAVE = "Have you owned delivery from planning through completion?";
const RISKS = "Have you acted on delivery risks, dependencies, timelines, or budgets?";
const D1 = "Owned delivery of the checkout replatform from planning to go-live.";
const D2 = "Managed the project budget.";
const D3 = "Followed the retail seasonal release freeze.";
const DRAFTS: ReviewLine[] = [
  line("d1", D1, { state: "drafted", draft: { mustHave: MUST_HAVE, quote: null, flags: [], vague: [] } }),
  line("d2", D2, { state: "drafted", draft: { mustHave: null, quote: FIXED, flags: ["OPTIONAL"], vague: [] } }),
  line("d3", D3, { state: "drafted", draft: { mustHave: RISKS, quote: null, flags: ["INDUSTRY GUESS"], vague: [] } }),
];
function drafted(nrgLines: ReviewLine[] = DRAFTS, over: Partial<ReviewState> = {}): ReviewState {
  return {
    ...REVIEW,
    sections: REVIEW.sections.map((s) =>
      "jobs" in s
        ? {
            ...s,
            jobs: [
              { ...s.jobs[0]!, family: "IT Project Manager", lines: [...s.jobs[0]!.lines, ...nrgLines] },
              { ...s.jobs[1]!, family: null },
            ],
          }
        : s,
    ),
    ...over,
  };
}

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

/** Serves `state`, records every write, and lets a test move `state` between reads. */
async function stubReview(page: Page, initial: ReviewState = REVIEW) {
  const calls: Recorded[] = [];
  const box = { state: initial, reads: 0 };
  const record = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const req = route.request();
    calls.push({ method: req.method(), url: new URL(req.url()).pathname, body: req.postDataJSON?.() ?? null });
  };
  await page.route("**/api/review", async (route) => {
    box.reads += 1;
    await route.fulfill({ json: box.state });
  });
  await page.route("**/api/review/complete", async (route) => {
    record(route);
    box.state = { ...box.state, completed: true };
    await route.fulfill({ json: { completed: true } });
  });
  await page.route("**/api/cv/lines/*", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({ json: { id, state: (route.request().postDataJSON() as { state: string }).state } });
  });
  // #341: the fix door answers with the text the server now holds — the exact original on undo.
  await page.route("**/api/review/fixes/*", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const { applied } = route.request().postDataJSON() as { applied: boolean };
    const fix = jobsOf(box.state).flatMap((j) => j.lines).find((l) => l.id === id)?.fix;
    await route.fulfill({ json: { id, text: applied ? fix?.corrected : fix?.original, applied } });
  });
  await page.route("**/api/review/jobs/*/end", async (route) => {
    record(route);
    await route.fulfill({ json: { ok: true } });
  });
  // #342: the tick answers with the text the server holds; the edit echoes the wording it stored.
  const draftLine = (id: string) => jobsOf(box.state).flatMap((j) => j.lines).find((l) => l.id === id);
  await page.route("**/api/review/drafts/*/tick", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    await route.fulfill({ json: { id, text: draftLine(id)?.text, state: "ticked" } });
  });
  await page.route("**/api/review/drafts/*", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const { text } = route.request().postDataJSON() as { text: string };
    // The server now holds the person's wording: a later tick answers with it.
    box.state = {
      ...box.state,
      sections: box.state.sections.map((s) =>
        "jobs" in s ? { ...s, jobs: s.jobs.map((j) => ({ ...j, lines: j.lines.map((l) => (l.id === id ? { ...l, text } : l)) })) } : s,
      ),
    };
    await route.fulfill({ json: { id, text } });
  });
  await page.route("**/api/review/conflicts/*", async (route) => {
    record(route);
    await route.fulfill({ json: { ok: true } });
  });
  return { calls, box };
}

const sheet = (page: Page) => page.getByRole("dialog");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubSession(page);
});

test("the paper: letterhead first, then each job with its lines as read, in the CV's own order", async ({ page }) => {
  await stubReview(page);
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: "Your CV, reviewed" })).toBeVisible();
  // Letterhead first: the mark carrying the details sits above the first job on the paper.
  const letterhead = page.getByRole("button", { name: "Your details" });
  await expect(letterhead).toContainText("Jane Doe");
  await expect(letterhead).toContainText("jane.doe@example.com");
  const paper = page.locator(".paper");
  const order = await paper.locator(".lhmark, .pjob").evaluateAll((els) => els.map((el) => el.className.split(" ")[0]));
  expect(order).toEqual(["lhmark", "pjob", "pjob"]);

  // Then job by job, in order, each with its lines — and the sections around them in print order.
  const jobs = paper.locator(".pjob");
  await expect(jobs.nth(0)).toContainText("IT Project Manager");
  await expect(jobs.nth(0)).toContainText("Nordic Retail Group");
  await expect(jobs.nth(0)).toContainText("Mar 2021 – now");
  await expect(jobs.nth(0).getByRole("button", { name: "Led the checkout replatform." })).toBeVisible();
  await expect(jobs.nth(0).getByRole("button", { name: "Managed a budget of EUR 1.2M across 3 vendor teams." })).toBeVisible();
  await expect(jobs.nth(1)).toContainText("Project Coordinator");
  // textContent, not innerText: the paper renders section headings in small caps.
  const headings = await paper.locator("h5").evaluateAll((els) => els.map((el) => el.textContent));
  expect(headings).toEqual(["Professional Summary", "Professional Experience", "Skills", "Education"]);
  // Two things to check: the conflict and the missing end date.
  await expect(page.locator(".chud .count")).toContainText("2 to check");
  // No review has run: no marks, no legend, no progress card, the confirm open.
  await expect(page.locator(".paper mark.fx, .paper li.sg, .legend, .prog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I'm done — show my jobs" })).toBeEnabled();
});

test("untick moves a line to kept, re-tick restores it — each tap is sent and the paper re-renders", async ({ page }) => {
  const { calls } = await stubReview(page);
  await page.goto("/review");

  const line = page.getByRole("button", { name: "Managed a budget of EUR 1.2M across 3 vendor teams." });
  await line.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "On your CV" })).toBeFocused();
  await sheet(page).getByRole("button", { name: "Untick — keep it for when a job needs it" }).click();

  await expect(sheet(page)).toHaveCount(0);
  expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/nrg-2", body: { state: "kept" } }]);
  const keptRow = page.locator(".pjob li.kept");
  await expect(keptRow).toHaveCount(1);
  await expect(keptRow).toContainText("kept ·");
  await expect(keptRow).toContainText("Managed a budget");
  // Focus returns to the line that opened the sheet.
  await expect(page.locator(".pjob li.kept .line")).toBeFocused();

  await page.locator(".pjob li.kept .line").click();
  await expect(sheet(page).getByRole("heading", { name: "Kept, not on your CV" })).toBeVisible();
  await sheet(page).getByRole("button", { name: "Tick — put it back on my CV" }).click();
  await expect(page.locator(".pjob li.kept")).toHaveCount(0);
  expect(calls[1]).toEqual({ method: "PUT", url: "/api/cv/lines/nrg-2", body: { state: "ticked" } });
});

test("a job with no end date asks on its card; Not sure sends nothing; an answer is sent as month and year", async ({ page }) => {
  const { calls, box } = await stubReview(page);
  await page.goto("/review");

  const bsh = page.locator(".pjob").nth(1);
  const pill = bsh.getByRole("button", { name: "When did you leave Baltic Software House?" });
  await expect(pill).toHaveText("end date?");
  await expect(page.locator(".pjob").nth(0).locator(".pill")).toHaveCount(0); // a dated job asks nothing

  await pill.click();
  await expect(sheet(page).getByRole("heading", { name: "When did you leave Baltic Software House?" })).toBeVisible();
  await sheet(page).getByRole("button", { name: "Not sure" }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(calls).toEqual([]); // "Not sure" stores nothing

  await pill.click();
  await sheet(page).getByRole("combobox", { name: "Month" }).selectOption("March");
  await sheet(page).getByRole("textbox", { name: "Year" }).fill("2021");
  // The paper re-reads the server after the answer: the stub now dates the job.
  box.state = {
    ...REVIEW,
    sections: REVIEW.sections.map((s) =>
      "jobs" in s
        ? { ...s, jobs: s.jobs.map((j) => (j.id === "bsh" ? { ...j, dates: { start: "Jun 2017", end: "Mar 2021" }, endDateQuestion: null } : j)) }
        : s,
    ),
  };
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(calls).toEqual([{ method: "POST", url: "/api/review/jobs/bsh/end", body: { answer: "March 2021" } }]);
  await expect(bsh).toContainText("Jun 2017 – Mar 2021");
  await expect(bsh.locator(".pill")).toHaveCount(0);
  await expect(page.locator(".chud .count")).toContainText("1 to check");
  // The pill that opened the sheet is gone, so focus lands on the paper — never on the body.
  await expect(page.locator(".paper")).toBeFocused();
});

test("an import conflict is shown on the paper and settled there, once", async ({ page }) => {
  const { calls, box } = await stubReview(page);
  await page.goto("/review");

  const pill = page.getByRole("button", { name: "City: your CV says Paris and also Lyon. Which one is right?" });
  await expect(pill).toHaveText("Paris or Lyon?");
  await pill.click();
  await expect(sheet(page).getByRole("heading", { name: /Paris and also Lyon/ })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Not sure" })).toBeVisible();
  box.state = { ...REVIEW, conflict: null };
  await sheet(page).getByRole("button", { name: "Paris", exact: true }).click();

  await expect(sheet(page)).toHaveCount(0);
  expect(calls).toEqual([{ method: "POST", url: "/api/review/conflicts/city", body: { value: "Paris" } }]);
  await expect(page.locator(".paper .conflict")).toHaveCount(0);
});

test("the letterhead opens the details, where each field has its own Edit", async ({ page }) => {
  await stubReview(page);
  await page.route("**/api/contact", async (route) => {
    const { field, value } = route.request().postDataJSON() as { field: string; value: string };
    await route.fulfill({
      json: { phone: CONTACT_PHONE, email: CONTACT_EMAIL, [field]: { value, origin: "person-said", sourceText: value } },
    });
  });
  await page.goto("/review");
  await page.getByRole("button", { name: "Your details" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(sheet(page)).toContainText("Check these. They go at the top of every CV.");
  await sheet(page).getByRole("button", { name: "Edit Email" }).click();
  const input = sheet(page).getByRole("textbox", { name: "Email" });
  await expect(input).toBeFocused();
  await input.fill("jane@example.org");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(sheet(page)).toContainText("jane@example.org");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Your details" })).toContainText("jane@example.org");
});

test("the confirm completes the review and hands off to the jobs", async ({ page }) => {
  const { calls } = await stubReview(page);
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = { stage: "deck", cards: [], authed: true, pendingCount: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto("/review");
  await page.getByRole("button", { name: "I'm done — show my jobs" }).click();
  await page.waitForURL("/deck");
  expect(calls).toEqual([{ method: "POST", url: "/api/review/complete", body: null }]);
});

test("the deck sends an unreviewed session to the review", async ({ page }) => {
  await stubReview(page);
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = { stage: "deck", cards: [], authed: false, pendingCount: 0, reviewPending: true };
    await route.fulfill({ json: body });
  });
  await page.goto("/deck");
  await page.waitForURL("/review");
  await expect(page.getByRole("heading", { name: "Your CV, reviewed" })).toBeVisible();
});

test("with the review failed to load, the screen says so and offers a retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/review", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 500, json: { error: { code: "boom" } } });
    else await route.fulfill({ json: REVIEW });
  });
  await page.goto("/review");
  await expect(page.locator(".review .loadstate[role=alert]")).toContainText("Couldn't load your CV.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Your CV, reviewed" })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// #341 — the review runs in the background: its progress, its fixes, its suggestions.
// ---------------------------------------------------------------------------------------------

test("while the review runs: the progress card, the unanswered job greyed and still being checked, the confirm locked — then the next read lands the marks and the card goes", async ({ page }) => {
  // The first job has landed (its fix is on the paper); the second is still being checked.
  const running = marked({ progress: { done: 1, total: 2, minutesLeft: 4 } });
  const bshRunning = { ...jobsOf(running)[1]!, checking: true, lines: [line("bsh-1", "Coordinated releases for 4 agile squads."), line("bsh-2", AIM)] };
  running.sections = running.sections.map((s) => ("jobs" in s ? { ...s, jobs: [s.jobs[0]!, bshRunning] } : s));
  const { box } = await stubReview(page, running);
  await page.goto("/review");

  const card = page.getByRole("status");
  await expect(card).toContainText("Checking your CV… 1 of 2 jobs ready");
  await expect(card).toContainText("About 4 minutes left. You can start with the parts that are ready.");
  await expect(page.locator(".legend")).toContainText("fixed");
  const bsh = page.locator(".pjob").nth(1);
  await expect(bsh).toHaveClass(/busy/);
  await expect(bsh).toContainText("Still checking this job");
  await expect(bsh.getByRole("button", { name: "Coordinated releases for 4 agile squads." })).toBeVisible(); // its lines as read, still tappable
  await expect(bsh.locator("li.sg")).toHaveCount(0); // no suggestion yet
  await expect(page.locator(".pjob").nth(0)).not.toHaveClass(/busy/);
  await expect(page.locator(".pjob").nth(0).locator("mark.fx")).toHaveText("across"); // the finished job opened as it arrived
  const cta = page.getByRole("button", { name: "I'm done — show my jobs" });
  await expect(cta).toBeDisabled();
  await expect(page.locator(".foot p")).toHaveText("Your jobs open when the check is finished.");

  // The run finishes; the screen's next read (it polls while the card shows) lands the second job —
  // exactly one read: the first poll after the run finished brings the marks, and the polling stops.
  box.state = marked();
  box.reads = 0;
  await expect(card).toHaveCount(0, { timeout: 10_000 });
  await expect(bsh).not.toHaveClass(/busy/);
  await expect(bsh.locator("li.sg")).toHaveCount(1);
  await expect(cta).toBeEnabled();
  await expect(page.locator(".foot p")).toHaveText("You can come back to this page at any time.");
  expect(box.reads).toBe(1);
});

test("a fix: the corrected words marked green on the paper; the sheet lists original → corrected; Undo restores the original, Use fix applies it again", async ({ page }) => {
  const { calls } = await stubReview(page, marked());
  await page.goto("/review");

  const nrg = page.locator(".pjob").nth(0);
  const fixed = nrg.getByRole("button", { name: FIXED });
  await expect(fixed.locator("mark.fx")).toHaveText("across");
  await fixed.click();
  await expect(sheet(page)).toContainText("We fixed a small mistake");
  await expect(sheet(page).locator(".fixdiff s")).toHaveText("accross");
  await expect(sheet(page).locator(".fixdiff .to")).toHaveText("across");
  await expect(sheet(page).locator(".quote")).toHaveText(FIXED);

  await sheet(page).getByRole("button", { name: "Undo" }).click();
  expect(calls).toEqual([{ method: "PUT", url: "/api/review/fixes/nrg-2", body: { applied: false } }]);
  // The sheet stays open on the line, now reading the exact original, and offers the fix again.
  await expect(sheet(page).locator(".quote")).toHaveText(TYPO);
  await expect(sheet(page).getByRole("button", { name: "Use fix" })).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(nrg.getByRole("button", { name: TYPO })).toBeVisible();
  await expect(nrg.locator("mark.fx")).toHaveCount(0);
  await expect(nrg.locator("li.kept")).toHaveCount(0); // undoing a fix is not an untick

  await nrg.getByRole("button", { name: TYPO }).click();
  await sheet(page).getByRole("button", { name: "Use fix" }).click();
  expect(calls[1]).toEqual({ method: "PUT", url: "/api/review/fixes/nrg-2", body: { applied: true } });
  await expect(sheet(page).locator(".quote")).toHaveText(FIXED);
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(nrg.locator("mark.fx")).toHaveText("across");
});

test("fixes outside the jobs sit where the line sits: summary, skills, education", async ({ page }) => {
  await stubReview(page, marked());
  await page.goto("/review");
  const paper = page.locator(".paper");
  // The mark is the whole word that changed — a dropped letter or an added full stop still shows.
  await expect(paper.locator("section[aria-label='Professional Summary'] mark.fx")).toHaveText("Delivery-accountable");
  await expect(paper.locator("section[aria-label='Skills'] mark.fx")).toHaveText("Project.");
  await expect(paper.locator("section[aria-label='Education'] mark.fx")).toHaveText("Warsaw.");
  await expect(paper.locator("mark.fx")).toHaveCount(4); // + the job line
});

test("a suggestion: the amber band on the line, the reason in the sheet, one tap unticks — the line was ticked until then", async ({ page }) => {
  const { calls } = await stubReview(page, marked());
  await page.goto("/review");

  // The suggestion counts as something to check (with the conflict and the end date).
  await expect(page.locator(".chud .count")).toContainText("3 to check");
  await expect(page.locator(".legend")).toContainText("suggestion");
  const bsh = page.locator(".pjob").nth(1);
  const band = bsh.locator("li.sg");
  await expect(band).toHaveCount(1);
  await expect(band).toContainText(AIM);
  await expect(band).not.toHaveClass(/kept/); // still ticked: the machine removed nothing

  await band.getByRole("button", { name: AIM }).click();
  await expect(sheet(page).getByRole("heading", { name: "On your CV" })).toBeVisible();
  await expect(sheet(page).locator(".sugg")).toContainText("Suggestion: untick this line.");
  await expect(sheet(page).locator(".sugg")).toContainText(REASON);
  const untick = sheet(page).getByRole("button", { name: "Untick — keep it for when a job needs it" });
  await expect(untick).toHaveClass(/warn/);
  await untick.click();

  expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/bsh-2", body: { state: "kept" } }]);
  await expect(bsh.locator("li.sg")).toHaveCount(0);
  await expect(bsh.locator("li.kept")).toContainText(AIM);
  await expect(page.locator(".chud .count")).toContainText("2 to check");
  // "Next ↓" walks to the suggestion when one is open: the band is a mark.
  await page.locator(".paper li.kept .line").click();
  await sheet(page).getByRole("button", { name: "Tick — put it back on my CV" }).click();
  await expect(bsh.locator("li.sg .line.mark")).toHaveCount(1);
});

// ---------------------------------------------------------------------------------------------
// #342 — drafted lines for missing must-haves.
// ---------------------------------------------------------------------------------------------

test("drafted lines: unticked boxes at the end of their job, flags inline, the source under each without a tap; a job in no family has none; the counter and the footer count them", async ({ page }) => {
  await stubReview(page, drafted());
  await page.goto("/review");

  const nrg = page.locator(".pjob").nth(0);
  const boxes = nrg.locator("li.nl");
  await expect(boxes).toHaveCount(3);
  // At the end of the job: every box comes after the lines as read.
  const order = await nrg.locator("li").evaluateAll((els) => els.map((el) => (el.classList.contains("nl") ? "new" : "read")));
  expect(order).toEqual(["read", "read", "new", "new", "new"]);
  await expect(boxes.nth(0).getByRole("button", { name: D1 })).toBeVisible();
  await expect(boxes.nth(0).locator(".flag")).toHaveCount(0);
  await expect(boxes.nth(1).locator(".flag")).toHaveText(["OPTIONAL"]);
  await expect(boxes.nth(2).locator(".flag")).toHaveText(["INDUSTRY GUESS"]);
  // The source, shown without a tap: the must-have in the family's words, and/or the CV's own words.
  await expect(boxes.nth(0).locator(".src")).toHaveText(`IT Project Manager jobs ask: "${MUST_HAVE}"`);
  await expect(boxes.nth(1).locator(".src")).toHaveText(`From your CV: "${FIXED}"`);
  await expect(boxes.nth(2).locator(".src")).toContainText(`"${RISKS}"`);
  await expect(boxes.getByRole("button", { name: "Tick — put it on my CV" })).toHaveCount(3);
  // No draft reads as on the CV: no "new" tag anywhere yet, no stamp on either job.
  await expect(page.locator(".paper .ntag, .paper .stamp")).toHaveCount(0);
  await expect(page.locator(".pjob").nth(1).locator("li.nl")).toHaveCount(0);
  await expect(page.locator(".chud .count")).toHaveText("2 to check · 3 new lines to tick or leave");
  await expect(page.locator(".legend")).toContainText("new line");
  await expect(page.locator(".foot p")).toHaveText("3 new lines are not ticked. They will not go on your CV. You can come back to this page at any time.");
});

test("the + ticks a draft: the tap is sent, the box becomes an ordinary bullet with a new tag, the counts move", async ({ page }) => {
  const { calls } = await stubReview(page, drafted());
  await page.goto("/review");

  const nrg = page.locator(".pjob").nth(0);
  await nrg.locator("li.nl").nth(0).getByRole("button", { name: "Tick — put it on my CV" }).click();
  expect(calls).toEqual([{ method: "POST", url: "/api/review/drafts/d1/tick", body: null }]);
  await expect(nrg.locator("li.nl")).toHaveCount(2);
  const ticked = nrg.getByRole("button", { name: `${D1} new` });
  await expect(ticked).toBeVisible();
  await expect(ticked.locator(".ntag")).toHaveText("new");
  await expect(nrg.locator("li.kept")).toHaveCount(0);
  await expect(page.locator(".chud .count")).toHaveText("2 to check · 2 new lines to tick or leave");
  await expect(page.locator(".foot p")).toContainText("2 new lines are not ticked.");
});

test("the sheet on a draft: the full source, Edit stores the person's wording before the tick, Tick puts it on the CV in those words", async ({ page }) => {
  const { calls } = await stubReview(page, drafted());
  await page.goto("/review");
  const mine = "Owned delivery of the checkout replatform from kick-off to go-live, on a fixed date.";

  const nrg = page.locator(".pjob").nth(0);
  await nrg.locator("li.nl").nth(0).getByRole("button", { name: D1 }).click();
  await expect(sheet(page).getByRole("heading", { name: "New line, not on your CV yet" })).toBeFocused();
  await expect(sheet(page).locator(".quote")).toHaveText(D1);
  await expect(sheet(page).locator(".why")).toContainText(`Why: IT Project Manager jobs ask: "${MUST_HAVE}"`);

  await sheet(page).getByRole("button", { name: "Edit" }).click();
  const box = sheet(page).getByRole("textbox", { name: "New line, not on your CV yet" });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(D1);
  await box.fill(mine);
  await sheet(page).getByRole("button", { name: "Save" }).click();
  expect(calls).toEqual([{ method: "PUT", url: "/api/review/drafts/d1", body: { text: mine } }]);
  // Still a draft, in the person's words, with its source: the sheet stays open on it.
  await expect(sheet(page).locator(".quote")).toHaveText(mine);
  await expect(sheet(page).locator(".why")).toContainText(MUST_HAVE);
  await expect(sheet(page).getByRole("button", { name: "Tick — put it on my CV" })).toBeVisible();

  await sheet(page).getByRole("button", { name: "Tick — put it on my CV" }).click();
  expect(calls[1]).toEqual({ method: "POST", url: "/api/review/drafts/d1/tick", body: null });
  await expect(sheet(page)).toHaveCount(0);
  await expect(nrg.getByRole("button", { name: `${mine} new` })).toBeVisible();
  await expect(nrg.locator("li.nl")).toHaveCount(2);
});

test("a ticked draft is an ordinary line: it unticks to kept like any other, and its sheet still shows where it came from", async ({ page }) => {
  const accepted = line("d1", D1, { state: "ticked", draft: { mustHave: MUST_HAVE, quote: null, flags: [], vague: [] } });
  const { calls } = await stubReview(page, drafted([accepted, DRAFTS[1]!]));
  await page.goto("/review");

  const nrg = page.locator(".pjob").nth(0);
  await expect(nrg.locator("li.nl")).toHaveCount(1);
  await nrg.getByRole("button", { name: `${D1} new` }).click();
  await expect(sheet(page).getByRole("heading", { name: "On your CV" })).toBeVisible();
  await expect(sheet(page).locator(".why")).toContainText(MUST_HAVE);
  await sheet(page).getByRole("button", { name: "Untick — keep it for when a job needs it" }).click();
  expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/d1", body: { state: "kept" } }]);
  await expect(nrg.locator("li.kept")).toContainText(D1);
  await expect(page.locator(".chud .count")).toHaveText("2 to check · 1 new line to tick or leave");
});

test("a job with nothing missing wears the COMPLETE ✓ stamp, and its sheet says so; a job in no family wears nothing", async ({ page }) => {
  const complete = drafted([]);
  complete.sections = complete.sections.map((s) => ("jobs" in s ? { ...s, jobs: [{ ...s.jobs[0]!, complete: true }, s.jobs[1]!] } : s));
  await stubReview(page, complete);
  await page.goto("/review");

  const stamp = page.locator(".pjob").nth(0).getByRole("button", { name: "COMPLETE ✓ This job is already complete." });
  await expect(stamp).toHaveText("COMPLETE ✓");
  await expect(page.locator(".pjob").nth(1).locator(".stamp, li.nl")).toHaveCount(0);
  await expect(page.locator(".chud .count")).toHaveText("2 to check");
  await stamp.click();
  await expect(sheet(page).getByRole("heading", { name: "This job is already complete." })).toBeVisible();
  await expect(sheet(page)).toContainText("Your lines already show everything IT Project Manager jobs ask for.");
});

// ---------------------------------------------------------------------------------------------
// #343 — word choices on a drafted line's vague phrase.
// ---------------------------------------------------------------------------------------------
const PHRASE = "planning to go-live";
const CV_CHOICE = "the business case to the store roll-out";
const TYPICAL_CHOICE = "kick-off to hand-over";
const VAGUE_D1 = line("d1", D1, {
  state: "drafted",
  draft: {
    mustHave: MUST_HAVE,
    quote: null,
    flags: [],
    vague: [{ phrase: PHRASE, options: [{ text: CV_CHOICE, from: "CV", quote: FIXED }, { text: TYPICAL_CHOICE, from: "TYPICAL", quote: null }] }],
  },
});
const withChoices = () => drafted([VAGUE_D1, DRAFTS[1]!, DRAFTS[2]!]);

test("a vague phrase wears the dotted underline; a tap opens its choices, CV first then typical, each tagged, with no request; a pick replaces the phrase and is saved", async ({ page }) => {
  const { calls, box } = await stubReview(page, withChoices());
  await page.goto("/review");

  const nrg = page.locator(".pjob").nth(0);
  await expect(nrg.locator("li.nl .ph")).toHaveText([PHRASE]);
  await expect(page.locator(".legend .l4")).toHaveText("choose a word");
  await nrg.locator("li.nl .ph").click();

  const choices = sheet(page).getByRole("group", { name: `Make "${PHRASE}" specific:` });
  await expect(choices).toBeVisible();
  await expect(choices.locator(".ch-g")).toHaveText(["From your CV", "Typical"]);
  await expect(choices.locator(".chip .mk")).toHaveText(["YOUR CV", "TYPICAL"]);
  await expect(choices.locator(".chip").nth(0)).toContainText(FIXED); // the CV words the choice came from
  await expect(choices.getByRole("textbox", { name: "Or type your own" })).toBeVisible();
  // The choices came with the review: opening them asked nothing.
  expect(calls).toEqual([]);
  expect(box.reads).toBe(1);

  await choices.getByRole("button", { name: new RegExp(CV_CHOICE) }).click();
  const picked = D1.replace(PHRASE, CV_CHOICE);
  expect(calls).toEqual([{ method: "PUT", url: "/api/review/drafts/d1", body: { text: picked } }]);
  // The line reads the person's choice, on the paper and in the sheet; the choice stays tappable
  // (a solid underline) so it can be changed.
  await expect(sheet(page).locator(".quote")).toHaveText(picked);
  await expect(sheet(page).getByRole("group")).toHaveCount(0);
  await expect(nrg.locator("li.nl").nth(0)).toContainText(picked);
  await expect(nrg.locator(".ph.set")).toHaveText([CV_CHOICE]);
  await sheet(page).locator(".quote").getByRole("button", { name: CV_CHOICE }).click();
  await choices.getByRole("button", { name: new RegExp(TYPICAL_CHOICE) }).click();
  expect(calls[1]).toEqual({ method: "PUT", url: "/api/review/drafts/d1", body: { text: D1.replace(PHRASE, TYPICAL_CHOICE) } });
  await expect(nrg.locator(".ph.set")).toHaveText([TYPICAL_CHOICE]);
});

test("the person's own words replace the phrase; the line ticked prints those words; the sheet's phrase button opens the same choices", async ({ page }) => {
  const { calls } = await stubReview(page, withChoices());
  await page.goto("/review");
  const mine = "the first workshop to the 40-store launch";

  const nrg = page.locator(".pjob").nth(0);
  // A tap anywhere else on the line opens its sheet with the choices closed; the phrase in the
  // quote is a button that opens them.
  await nrg.locator("li.nl").nth(0).getByRole("button", { name: D1 }).focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("group")).toHaveCount(0);
  const phraseButton = sheet(page).locator(".quote").getByRole("button", { name: PHRASE });
  await expect(phraseButton).toHaveAttribute("aria-expanded", "false");
  await phraseButton.click();
  await expect(phraseButton).toHaveAttribute("aria-expanded", "true");

  const choices = sheet(page).getByRole("group", { name: `Make "${PHRASE}" specific:` });
  await expect(choices.getByRole("button", { name: "Use" })).toBeDisabled();
  await choices.getByRole("textbox", { name: "Or type your own" }).fill(`  ${mine} `);
  await choices.getByRole("button", { name: "Use" }).click();
  const typed = D1.replace(PHRASE, mine);
  expect(calls).toEqual([{ method: "PUT", url: "/api/review/drafts/d1", body: { text: typed } }]);
  await expect(sheet(page).locator(".quote")).toHaveText(typed);

  await sheet(page).getByRole("button", { name: "Tick — put it on my CV" }).click();
  expect(calls[1]).toEqual({ method: "POST", url: "/api/review/drafts/d1/tick", body: null });
  await expect(nrg.getByRole("button", { name: `${typed} new` })).toBeVisible();
});
