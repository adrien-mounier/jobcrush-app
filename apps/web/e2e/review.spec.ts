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

const CONTACT_PHONE = { value: "+33 6 00 00 00 00", origin: "read" as const };
const CONTACT_EMAIL = { value: "jane.doe@example.com", origin: "read" as const };

const line = (id: string, text: string, over: Partial<ReviewLine> = {}): ReviewLine => ({
  id,
  text,
  state: "ticked",
  fix: null,
  suggestion: null,
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
