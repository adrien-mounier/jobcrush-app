import { expect, test, type Page } from "@playwright/test";
import type { CardsResponse, ReviewLine, ReviewState, ReviewWorkRights } from "../lib/api";

// #377 check mode (ADR-0018 clause 3): the guided walk over the profile that replaced "Your CV,
// reviewed", route-mocked to the pinned ReviewState shape. What it proves on the screen: the walk
// opens at Your details and moves one screen per section in the server's order, empty sections
// skipped, with the progress line marking done / current / to come; ⊖ removes an item (the tap is
// sent as the kept state), it lists under the removed count and Put back restores it; Finish
// completes the review and the done screen hands off to the deck; the deck and the old review
// address both land here; the three motion cues play once each and never under reduced motion;
// and at phone width nothing scrolls sideways while the footer button sits at thumb height.
// Controls are selected by structure (the footer's one primary button, an item's ⊖), never by copy.

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
  letterhead: { header: "Jane Doe\nParis, France", phone: { value: "+33 6 00 00 00 00", origin: "read" }, email: { value: "jane.doe@example.com", origin: "read" } },
  conflict: null,
  progress: null,
  unchecked: false,
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
  workRights: [],
  languages: [],
};
/** The screens REVIEW makes, in order: empty Certifications is skipped; Languages never is (#376 —
 *  a CV with none gets the card asking which languages the person speaks). */
const SCREENS = ["Your details", "About you", "Nordic Retail Group", "Baltic Software House", "Skills", "Education", "Languages"];

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

/** Serves `state`, records every write, and moves a line's state the way the server would. */
async function stubReview(page: Page, initial: ReviewState = REVIEW) {
  const calls: Recorded[] = [];
  const box = { state: initial };
  const record = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const req = route.request();
    calls.push({ method: req.method(), url: new URL(req.url()).pathname, body: req.postDataJSON?.() ?? null });
  };
  await page.route("**/api/review", async (route) => {
    await route.fulfill({ json: box.state });
  });
  await page.route("**/api/review/complete", async (route) => {
    record(route);
    box.state = { ...box.state, completed: true };
    await route.fulfill({ json: { completed: true } });
  });
  // #376: a work-rights tap stores that row's answer; the languages card stores the whole list.
  await page.route("**/api/review/work-rights/*", async (route) => {
    record(route);
    const itemId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    const { answer } = route.request().postDataJSON() as { answer: ReviewWorkRights["answer"] };
    box.state = { ...box.state, workRights: box.state.workRights.map((r) => (r.itemId === itemId ? { ...r, answer } : r)) };
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/review/languages", async (route) => {
    record(route);
    const { languages } = route.request().postDataJSON() as { languages: string[] };
    box.state = { ...box.state, languages };
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/cv/lines/*", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const { state } = route.request().postDataJSON() as { state: ReviewLine["state"] };
    const swap = (l: ReviewLine) => (l.id === id ? { ...l, state } : l);
    box.state = {
      ...box.state,
      sections: box.state.sections.map((s) =>
        "jobs" in s ? { ...s, jobs: s.jobs.map((j) => ({ ...j, lines: j.lines.map(swap) })) } : { ...s, lines: s.lines.map(swap) },
      ),
    };
    await route.fulfill({ json: { id, state } });
  });
  return { calls, box };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const primary = (page: Page) => page.locator(".foot .primary");
const back = (page: Page) => page.locator(".foot .ghost");
const segments = (page: Page) => page.locator(".prog i");
const segmentClasses = (page: Page) => segments(page).evaluateAll((els) => els.map((el) => el.className));
const items = (page: Page) => page.locator("li.pt");
const removeButton = (item: ReturnType<Page["locator"]>) => item.locator(".ib.rmv");
const tray = (page: Page) => page.locator(".tray");
const cues = (page: Page) => page.locator(".prog i.sweep, .tray.bump, .foot .primary.arm");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubSession(page);
});

test("the walk opens at Your details and moves one screen per section in order, empty sections skipped; the progress line marks done, current and to come", async ({ page }) => {
  await stubReview(page);
  await page.goto("/profile/check");

  await expect(heading(page)).toHaveText(SCREENS[0]!);
  await expect(segments(page)).toHaveCount(SCREENS.length);
  expect(await segmentClasses(page)).toEqual(["cur", "", "", "", "", "", ""]);
  await expect(back(page)).toHaveCount(0); // nothing to go back to on the first screen
  await expect(primary(page)).toHaveText(`Next: ${SCREENS[1]}  →`);

  for (let i = 1; i < SCREENS.length; i++) {
    await primary(page).click();
    await expect(heading(page)).toHaveText(SCREENS[i]!);
    await expect(segments(page).nth(i)).toHaveClass("cur");
    await expect(segments(page).nth(i - 1)).toHaveClass(/done|sweep/);
  }
  // A job's screen says which job, under its employer.
  await back(page).click();
  await back(page).click();
  await back(page).click();
  await expect(heading(page)).toHaveText("Baltic Software House");
  await expect(page.locator(".bigsub")).toHaveText("Project Coordinator · Jun 2017");
  await back(page).click();
  await expect(page.locator(".bigsub")).toHaveText("IT Project Manager · Mar 2021 – now");
  expect(await segmentClasses(page)).toEqual(["done", "done", "cur", "", "", "", ""]);
  // The last screen offers the finish, and nothing else.
  for (let i = 2; i < SCREENS.length - 1; i++) await primary(page).click();
  await expect(heading(page)).toHaveText(SCREENS.at(-1)!);
  await expect(primary(page)).toHaveText("Finish my profile");
  // Every item of the walk is a plain line with no tick box anywhere.
  await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
});

test("⊖ removes an item: the tap is sent, the item lists under the removed count, and Put back restores it", async ({ page }) => {
  const { calls } = await stubReview(page);
  await page.goto("/profile/check");
  await primary(page).click();
  await primary(page).click();
  await expect(heading(page)).toHaveText("Nordic Retail Group");
  await expect(items(page)).toHaveCount(2);
  await expect(tray(page)).toHaveCount(0);

  const first = items(page).first();
  await expect(first).toContainText("Led the checkout replatform.");
  await first.hover();
  await removeButton(first).click();
  expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/nrg-1", body: { state: "kept" } }]);
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText("Managed a budget");

  const count = tray(page).getByRole("button", { expanded: false });
  await expect(count).toHaveText("1 removed · Show");
  await count.click();
  await expect(tray(page).locator("s")).toHaveText("Led the checkout replatform.");
  await expect(tray(page).getByRole("button", { expanded: true })).toHaveText("1 removed · Hide");
  await tray(page).locator("li button").click(); // Put back
  expect(calls[1]).toEqual({ method: "PUT", url: "/api/cv/lines/nrg-1", body: { state: "ticked" } });
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).first()).toContainText("Led the checkout replatform.");
  await expect(tray(page)).toHaveCount(0);
});

test("Finish completes check mode, and the done screen counts what is in, added and removed before handing off to the deck", async ({ page }) => {
  const { calls } = await stubReview(page);
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = { stage: "deck", cards: [], authed: true, pendingCount: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto("/profile/check");
  for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
  await expect(primary(page)).toHaveText("Finish my profile");
  await primary(page).click();

  expect(calls).toEqual([{ method: "POST", url: "/api/review/complete", body: null }]);
  await expect(heading(page)).toHaveText("Your profile is ready");
  const tally = await page.locator(".tally b").evaluateAll((els) => els.map((el) => el.textContent));
  expect(tally).toEqual(["6", "0", "0"]);
  await page.locator(".donepanel .primary").click();
  await page.waitForURL("/deck");
});

test("the deck sends an unreviewed session here, and the old review address forwards here", async ({ page }) => {
  await stubReview(page);
  await page.route("**/api/onboarding/cards", async (route) => {
    const body: CardsResponse = { stage: "deck", cards: [], authed: false, pendingCount: 0, reviewPending: true };
    await route.fulfill({ json: body });
  });
  await page.goto("/deck");
  await page.waitForURL("/profile/check");
  await expect(heading(page)).toHaveText("Your details");

  await page.goto("/review");
  await page.waitForURL("/profile/check");
  await expect(heading(page)).toHaveText("Your details");
});

/** The three cues: Next fills the finished segment (sweep), a removal makes the removed count glow
 *  (bump), the footer button pulses once when it turns gold (arm — here, when the running check
 *  finishes on the last screen and unlocks Finish). */
async function driveTheCues(page: Page, box: { state: ReviewState }) {
  await page.goto("/profile/check");
  await primary(page).click(); // sweep
  await primary(page).click();
  await items(page).first().hover();
  await removeButton(items(page).first()).click(); // bump
  await expect(tray(page)).toHaveCount(1);
  for (let i = 3; i < SCREENS.length; i++) await primary(page).click();
  await expect(primary(page)).toBeDisabled(); // the check is still running
  box.state = { ...box.state, progress: null }; // the next poll finds it finished
  await expect(primary(page)).toBeEnabled({ timeout: 10_000 }); // arm
}

test("the three motion cues play once each", async ({ page }) => {
  const { box } = await stubReview(page, { ...REVIEW, progress: { done: 1, total: 2, minutesLeft: 4 } });
  await page.goto("/profile/check");
  await primary(page).click();
  await expect(page.locator(".prog i.sweep")).toHaveCount(1);
  await expect(page.locator(".prog i.sweep")).toHaveCount(0); // played once, then the segment is simply done
  await expect(segments(page).first()).toHaveClass("done");

  await primary(page).click();
  await items(page).first().hover();
  await removeButton(items(page).first()).click();
  await expect(page.locator(".tray.bump")).toHaveCount(1);
  await expect(page.locator(".tray.bump")).toHaveCount(0);
  await expect(tray(page)).toHaveCount(1);

  for (let i = 3; i < SCREENS.length; i++) await primary(page).click();
  await expect(primary(page)).toBeDisabled();
  await expect(page.locator(".foot .primary.arm")).toHaveCount(0);
  box.state = { ...box.state, progress: null };
  await expect(page.locator(".foot .primary.arm")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(".foot .primary.arm")).toHaveCount(0);
  await expect(primary(page)).toBeEnabled();
});

test("under reduced motion none of the cues plays — the same walk, no animation class ever set", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { box } = await stubReview(page, { ...REVIEW, progress: { done: 1, total: 2, minutesLeft: 4 } });
  const seen: string[] = [];
  await page.exposeFunction("cueSeen", (cls: string) => seen.push(cls));
  await page.addInitScript(() => {
    // Any cue class that lands in the DOM, however briefly, is reported.
    new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target as HTMLElement;
        if (el.classList && /\b(sweep|bump|arm)\b/.test(el.className)) (window as unknown as { cueSeen: (c: string) => void }).cueSeen(el.className);
      }
      // The document itself, not documentElement: an init script runs before <html> exists.
    }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true });
  });
  await driveTheCues(page, box);
  await expect(cues(page)).toHaveCount(0);
  await expect(segments(page).first()).toHaveClass("done");
  expect(seen).toEqual([]);
});

test("at phone width nothing scrolls sideways, and the footer button sits at thumb height", async ({ page }) => {
  await stubReview(page);
  await page.goto("/profile/check");
  await primary(page).click();
  await primary(page).click();
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBe(clientWidth);
  const box = (await primary(page).boundingBox())!;
  // Docked to the bottom of an 844px-tall phone: its lower edge within the bottom 100px.
  expect(844 - (box.y + box.height)).toBeLessThan(100);
  expect(box.height).toBeGreaterThanOrEqual(44); // a thumb-sized target
});

test("with the check failed to load, the screen says so and offers a retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/review", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 500, json: { error: { code: "boom" } } });
    else await route.fulfill({ json: REVIEW });
  });
  await page.goto("/profile/check");
  await expect(page.locator(".check .loadstate[role=alert]")).toBeVisible();
  await page.locator(".check .loadstate button").click();
  await expect(heading(page)).toHaveText("Your details");
});

// #376 (ADR-0018 clauses 5, 7, 8): the start asks nothing after the upload, so work rights and
// languages are answered here. "Where you can work" is a plain card on the last screen, one row per
// target market, the CV's proposal pre-selected but not stored until tapped; the footer button names
// each market still open. Languages are their own screen; a CV with none gets a card asking.
test.describe("#376 where you can work and languages", () => {
  const row = (market: string, over: Partial<ReviewWorkRights> = {}): ReviewWorkRights => ({
    market,
    itemId: `eligibility-work-rights-${market.toLowerCase().replace(/\s+/g, "-")}`,
    answer: null,
    proposed: null,
    note: null,
    source: null,
    ...over,
  });
  const NATIONALITY = "Nationality: Australian, based in Hong Kong.";
  const WITH_MARKETS: ReviewState = {
    ...REVIEW,
    workRights: [
      row("Hong Kong"),
      row("Australia", { proposed: "eligible", note: "You're Australian, so I put yes.", source: NATIONALITY }),
    ],
  };
  const wrRows = (page: Page) => page.locator(".wrrow");
  const pill = (page: Page, i: number, answer: string) => wrRows(page).nth(i).locator(`input[type=radio][value="${answer}"]`);

  test("the last screen asks where you can work: one row per market, the CV's proposal pre-selected, and the button names each open market until it is tapped", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_MARKETS);
    await page.goto("/profile/check");
    for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
    await expect(primary(page)).toHaveText("Next: Additional information  →"); // Languages is no longer last
    await primary(page).click();

    await expect(heading(page)).toHaveText("Additional information");
    await expect(segments(page)).toHaveCount(SCREENS.length + 1);
    await expect(wrRows(page)).toHaveCount(2);
    await expect(wrRows(page).locator("legend")).toHaveText(["Hong Kong", "Australia"]);
    await expect(page.locator(".wrsrc q")).toHaveText(NATIONALITY);
    await expect(wrRows(page).nth(1)).toContainText("You're Australian, so I put yes.");
    // The proposal shows as the picked pill; Hong Kong has none.
    await expect(pill(page, 1, "eligible")).toBeChecked();
    await expect(wrRows(page).nth(0).locator("input:checked")).toHaveCount(0);
    // Nothing is answered yet — a proposal is not an answer — so both markets hold the button.
    await expect(primary(page)).toBeDisabled();
    await expect(primary(page)).toHaveText("Answer Hong Kong and Australia to continue");
    expect(calls).toEqual([]);

    await pill(page, 0, "needs-sponsorship").click({ force: true });
    await expect(primary(page)).toHaveText("Answer Australia to continue");
    await expect(pill(page, 0, "needs-sponsorship")).toBeChecked();
    // Tapping the pre-selected proposal is what answers it.
    await wrRows(page).nth(1).locator(".pill").first().click();
    await expect(primary(page)).toBeEnabled();
    await expect(primary(page)).toHaveText("Finish my profile");
    expect(calls).toEqual([
      { method: "PUT", url: "/api/review/work-rights/eligibility-work-rights-hong-kong", body: { answer: "needs-sponsorship" } },
      { method: "PUT", url: "/api/review/work-rights/eligibility-work-rights-australia", body: { answer: "eligible" } },
    ]);
    await primary(page).click();
    await expect(heading(page)).toHaveText("Your profile is ready");
    expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/review/complete", body: null });
  });

  test("with no target market there is no work-rights card and no Additional information screen", async ({ page }) => {
    await stubReview(page);
    await page.goto("/profile/check");
    for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
    await expect(heading(page)).toHaveText("Languages");
    await expect(primary(page)).toHaveText("Finish my profile");
    await expect(wrRows(page)).toHaveCount(0);
  });

  test("Languages: with none on the CV the screen asks which languages, saves what is typed, and reads it back", async ({ page }) => {
    const { calls } = await stubReview(page);
    await page.goto("/profile/check");
    for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
    await expect(heading(page)).toHaveText("Languages");
    await expect(items(page)).toHaveCount(0);
    const card = page.locator(".langs");
    await expect(card.locator("h3")).toHaveText("Which languages do you speak?");
    await card.locator("input").fill("English,  Polish ,");
    await card.locator("button").click();
    expect(calls).toEqual([{ method: "PUT", url: "/api/review/languages", body: { languages: ["English", "Polish"] } }]);
    // Read back from the server's state, not from what was typed.
    await expect(card.locator("input")).toHaveValue("English, Polish");
    // Not a gate: the screen's button never waits on languages.
    await expect(primary(page)).toBeEnabled();
  });

  test("Languages: the CV's languages are the screen's items, and no card asks", async ({ page }) => {
    await stubReview(page, {
      ...REVIEW,
      sections: REVIEW.sections.map((s) => (s.tag === "lang" && "lines" in s ? { ...s, lines: [line("l1", "Polish (Native)"), line("l2", "English (Fluent)")] } : s)),
    });
    await page.goto("/profile/check");
    for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
    await expect(heading(page)).toHaveText("Languages");
    await expect(items(page)).toHaveText(["Polish (Native)", "English (Fluent)"]);
    await expect(page.locator(".langs")).toHaveCount(0);
  });
});
