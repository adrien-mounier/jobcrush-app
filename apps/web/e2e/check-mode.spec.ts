import { expect, test, type Page } from "@playwright/test";
import type { CardsResponse, ReviewLine, ReviewState } from "../lib/api";

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
};
/** The screens REVIEW makes, in order: the two empty sections are skipped. */
const SCREENS = ["Your details", "About you", "Nordic Retail Group", "Baltic Software House", "Skills", "Education"];

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
  /** Moves one line the way the server would. */
  const move = (id: string, over: Partial<ReviewLine>) => {
    const swap = (l: ReviewLine) => (l.id === id ? { ...l, ...over } : l);
    box.state = {
      ...box.state,
      sections: box.state.sections.map((s) =>
        "jobs" in s ? { ...s, jobs: s.jobs.map((j) => ({ ...j, lines: j.lines.map(swap) })) } : { ...s, lines: s.lines.map(swap) },
      ),
    };
  };
  const lineIdOf = (route: Parameters<Parameters<Page["route"]>[1]>[0], back = 0) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1 - back]!);
  };
  await page.route("**/api/review/complete", async (route) => {
    record(route);
    // #378: the server refuses while a suggestion is unanswered.
    const open = box.state.sections.some((s) => ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines).some((l) => l.state === "drafted"));
    if (open) return route.fulfill({ status: 409, json: { error: { code: "suggestions_open", message: "Answer every suggestion to finish your profile." } } });
    box.state = { ...box.state, completed: true };
    await route.fulfill({ json: { completed: true } });
  });
  await page.route("**/api/cv/lines/*", async (route) => {
    record(route);
    const id = lineIdOf(route);
    const { state } = route.request().postDataJSON() as { state: ReviewLine["state"] };
    move(id, { state });
    await route.fulfill({ json: { id, state } });
  });
  // #378: a draft's three answers — its wording (Edit first), the tick (Add it), No thanks and its Undo.
  await page.route("**/api/review/drafts/*", async (route) => {
    record(route);
    const id = lineIdOf(route);
    const { text } = route.request().postDataJSON() as { text: string };
    move(id, { text });
    await route.fulfill({ json: { id, text } });
  });
  await page.route("**/api/review/drafts/*/tick", async (route) => {
    record(route);
    const id = lineIdOf(route, 1);
    move(id, { state: "ticked" });
    await route.fulfill({ json: { id, text: "", state: "ticked" } });
  });
  await page.route("**/api/review/drafts/*/dismissed", async (route) => {
    record(route);
    const id = lineIdOf(route, 1);
    const { dismissed } = route.request().postDataJSON() as { dismissed: boolean };
    const state = dismissed ? "dismissed" : "drafted";
    move(id, { state });
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
  expect(await segmentClasses(page)).toEqual(["cur", "", "", "", "", ""]);
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
  await expect(heading(page)).toHaveText("Baltic Software House");
  await expect(page.locator(".bigsub")).toHaveText("Project Coordinator · Jun 2017");
  await back(page).click();
  await expect(page.locator(".bigsub")).toHaveText("IT Project Manager · Mar 2021 – now");
  expect(await segmentClasses(page)).toEqual(["done", "done", "cur", "", "", ""]);
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

// #378 — add suggestions answered in place (ADR-0018 clauses 4 and 7): a drafted line shows inline
// in its job as an add card; Add it, Edit first and No thanks each persist across a reload; Undo
// after No thanks restores the card; the footer waits until every suggestion on the screen is
// answered. Cards are selected by structure: `li.sg`, its `.row` buttons in the prototype's order
// (Add it, Edit first, No thanks), the "Only if true" badge as `.hd b`, the source as `.meta q`.
test.describe("#378 add suggestions answered in place", () => {
  const VAGUE = "the business and technical groups";
  const MUST = line("draft-nrg-1", `Owned end to end delivery for ${VAGUE}.`, {
    state: "drafted",
    draft: {
      mustHave: "Owns delivery end to end",
      quote: null,
      flags: [],
      vague: [{ phrase: VAGUE, options: [{ text: "the vendor teams", from: "CV", quote: "Led the checkout replatform." }, { text: "the steering committee", from: "TYPICAL", quote: null }] }],
    },
  });
  const OPTIONAL = line("draft-nrg-2", "Also coordinated releases for 4 agile squads.", {
    state: "drafted",
    draft: { mustHave: null, quote: "Coordinated releases for 4 agile squads.", flags: ["OPTIONAL"], vague: [] },
  });
  const GUESS = line("draft-nrg-3", "Followed the employer's release calendar.", {
    state: "drafted",
    draft: { mustHave: null, quote: "Led the checkout replatform.", flags: ["INDUSTRY GUESS"], vague: [] },
  });
  const WITH_DRAFTS: ReviewState = {
    ...REVIEW,
    sections: REVIEW.sections.map((s) =>
      "jobs" in s ? { ...s, jobs: s.jobs.map((j) => (j.id === "nrg" ? { ...j, family: "IT Project Manager", lines: [...j.lines, MUST, OPTIONAL, GUESS] } : j)) } : s,
    ),
  };
  const cards = (page: Page) => page.locator("li.sg");
  const answer = (card: ReturnType<Page["locator"]>, n: 0 | 1 | 2) => card.locator(".row button").nth(n); // Add it · Edit first · No thanks
  const gone = (page: Page) => page.locator("li.gone");
  const toNrg = async (page: Page) => {
    await page.goto("/profile/check");
    await primary(page).click();
    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");
  };

  test("drafts show inline in their job as add cards, Only if true only on the flagged ones; the footer waits until every one is answered, then pulses once", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_DRAFTS);
    await page.goto("/profile/check");
    await expect(cards(page)).toHaveCount(0); // not on Your details
    await primary(page).click();
    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");

    // Inline, after the job's own items, in the job's list.
    await expect(page.locator("ul.pts > li")).toHaveCount(5);
    await expect(items(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(0).locator(".stxt")).toHaveText(MUST.text);
    await expect(cards(page).nth(0).locator(".hd")).toContainText("Nordic Retail Group");
    await expect(cards(page).nth(0).locator(".mark.plus")).toHaveCount(1);
    await expect(cards(page).nth(0).locator(".hd b")).toHaveCount(0); // a must-have: no badge
    await expect(cards(page).nth(1).locator(".hd b")).toHaveCount(1); // OPTIONAL
    await expect(cards(page).nth(2).locator(".hd b")).toHaveCount(1); // INDUSTRY GUESS
    await expect(cards(page).nth(0).locator(".meta q")).toHaveCount(0); // no quote, no source line
    await expect(cards(page).nth(1).locator(".meta q")).toHaveText(OPTIONAL.draft!.quote!);
    await expect(cards(page).nth(0).locator(".meta")).toContainText(MUST.draft!.mustHave!);
    await expect(page.locator(".lead")).toContainText("3");

    // Held while any is open; the footer names what is left.
    await expect(primary(page)).toBeDisabled();
    await expect(primary(page)).toHaveText("Answer the suggestions to continue");

    await answer(cards(page).nth(0), 0).click(); // Add it
    await expect(cards(page)).toHaveCount(2);
    await expect(items(page)).toHaveCount(3);
    await expect(items(page).nth(2)).toContainText(MUST.text);
    await expect(items(page).nth(2).locator(".tag")).toHaveCount(1); // the "new" tag
    await expect(items(page).nth(0).locator(".tag")).toHaveCount(0);

    await answer(cards(page).nth(0), 2).click(); // No thanks
    await expect(gone(page)).toHaveCount(1);
    await expect(gone(page).locator("button")).toHaveCount(1); // Undo
    await expect(primary(page)).toBeDisabled();
    await expect(primary(page)).toHaveText("Answer the suggestion to continue");

    await answer(cards(page).nth(0), 1).click(); // Edit first
    const box = cards(page).nth(0).locator("textarea.ed");
    await expect(box).toHaveValue(GUESS.text);
    await expect(page.locator(".foot .primary.arm")).toHaveCount(0);
    await box.fill("Worked to the bank's release calendar.");
    await cards(page).nth(0).locator(".row button.primary").click(); // Add it
    await expect(cards(page)).toHaveCount(0);
    await expect(items(page).nth(3)).toContainText("Worked to the bank's release calendar.");

    await expect(primary(page)).toBeEnabled();
    await expect(primary(page)).toHaveText("Next: Baltic Software House  →");
    await expect(page.locator(".foot .primary.arm")).toHaveCount(1);
    await expect(page.locator(".foot .primary.arm")).toHaveCount(0); // once

    expect(calls).toEqual([
      { method: "POST", url: "/api/review/drafts/draft-nrg-1/tick", body: null },
      { method: "PUT", url: "/api/review/drafts/draft-nrg-2/dismissed", body: { dismissed: true } },
      { method: "PUT", url: "/api/review/drafts/draft-nrg-3", body: { text: "Worked to the bank's release calendar." } },
      { method: "POST", url: "/api/review/drafts/draft-nrg-3/tick", body: null },
    ]);
  });

  test("each answer persists across a reload — added items keep the new tag, the dismissed one never comes back — and the walk finishes", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_DRAFTS);
    await toNrg(page);
    await answer(cards(page).nth(0), 0).click(); // Add it
    await expect(cards(page)).toHaveCount(2);
    await answer(cards(page).nth(0), 2).click(); // No thanks
    await expect(gone(page)).toHaveCount(1);
    await answer(cards(page).nth(0), 1).click(); // Edit first
    await cards(page).nth(0).locator("textarea.ed").fill("Worked to the bank's release calendar.");
    await cards(page).nth(0).locator(".row button.primary").click();
    await expect(cards(page)).toHaveCount(0);

    await page.reload();
    await primary(page).click();
    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");
    await expect(cards(page)).toHaveCount(0);
    await expect(gone(page)).toHaveCount(0); // No thanks is stored, and says nothing after a reload
    await expect(items(page)).toHaveCount(4);
    await expect(items(page).nth(2)).toContainText(MUST.text);
    await expect(items(page).nth(3)).toContainText("Worked to the bank's release calendar.");
    await expect(items(page).locator(".tag")).toHaveCount(2);
    await expect(page.locator("ul.pts")).not.toContainText(OPTIONAL.text);
    await expect(primary(page)).toBeEnabled();

    for (let i = 3; i < SCREENS.length; i++) await primary(page).click();
    await primary(page).click(); // Finish my profile
    await expect(heading(page)).toHaveText("Your profile is ready");
    expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/review/complete", body: null });
    const tally = await page.locator(".tally b").evaluateAll((els) => els.map((el) => el.textContent));
    expect(tally).toEqual(["8", "2", "0"]); // in · added · removed
  });

  test("Undo after No thanks restores the card and holds the footer again; left alone, the No thanks row goes after a few seconds", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_DRAFTS);
    await toNrg(page);
    await answer(cards(page).nth(1), 2).click(); // No thanks on the OPTIONAL one
    await expect(cards(page)).toHaveCount(2);
    await gone(page).locator("button").click(); // Undo
    await expect(gone(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(1).locator(".stxt")).toHaveText(OPTIONAL.text);
    expect(calls).toEqual([
      { method: "PUT", url: "/api/review/drafts/draft-nrg-2/dismissed", body: { dismissed: true } },
      { method: "PUT", url: "/api/review/drafts/draft-nrg-2/dismissed", body: { dismissed: false } },
    ]);

    await answer(cards(page).nth(1), 2).click();
    await expect(gone(page)).toHaveCount(1);
    await expect(gone(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(cards(page)).toHaveCount(2);
  });

  test("a vague phrase on the card opens its word choices, CV first; a choice saves the line in those words", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_DRAFTS);
    await toNrg(page);
    const phrase = cards(page).nth(0).locator(".stxt button.ph");
    await expect(phrase).toHaveText(VAGUE);
    await expect(phrase).toHaveAttribute("aria-expanded", "false");
    await phrase.click();
    await expect(phrase).toHaveAttribute("aria-expanded", "true");
    const chips = cards(page).nth(0).locator(".wordchoices .chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveClass(/cv/);
    await expect(chips.nth(1)).toHaveClass(/typ/);
    expect(calls).toEqual([]); // opening them sends nothing
    await chips.nth(0).click();
    expect(calls).toEqual([{ method: "PUT", url: "/api/review/drafts/draft-nrg-1", body: { text: "Owned end to end delivery for the vendor teams." } }]);
    await expect(cards(page).nth(0).locator(".stxt")).toHaveText("Owned end to end delivery for the vendor teams.");
    await expect(cards(page).nth(0).locator(".wordchoices")).toHaveCount(0);
    await expect(primary(page)).toBeDisabled(); // a word choice is not an answer
  });
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

test.describe("#373 personal projects and additional information", () => {
  // The server now files a CV's personal projects and its nationality line in their own sections
  // (rootcv.ts SECTIONS: project right after experience, additional last), so the walk shows a
  // Personal projects screen between the last job and Skills and an Additional information screen
  // at the end, and About you keeps only the summary's own sentence.
  const WITH_PROJECTS: ReviewState = {
    ...REVIEW,
    sections: [
      ...REVIEW.sections.slice(0, 2),
      {
        tag: "project",
        heading: "Personal Projects",
        lines: [line("pr1", "Built a solar-powered garden sensor network."), line("pr2", "Maintain a family recipe wiki with 300 entries.")],
      },
      ...REVIEW.sections.slice(2),
      { tag: "additional", heading: "Additional Information", lines: [line("ad1", "Nationality: Portuguese")] },
    ],
  };
  const TITLES_WITH_PROJECTS = ["Your details", "About you", "Nordic Retail Group", "Baltic Software House", "Personal projects", "Skills", "Education", "Additional information"];

  test("the walk shows Personal projects between the last job and Skills, and Additional information last", async ({ page }) => {
    await stubReview(page, WITH_PROJECTS);
    await page.goto("/profile/check");
    await expect(segments(page)).toHaveCount(TITLES_WITH_PROJECTS.length);
    await expect(heading(page)).toHaveText(TITLES_WITH_PROJECTS[0]!);
    for (let i = 1; i < TITLES_WITH_PROJECTS.length; i++) {
      await primary(page).click();
      await expect(heading(page)).toHaveText(TITLES_WITH_PROJECTS[i]!);
      if (i === 1) await expect(items(page)).toHaveCount(1); // About you: the summary sentence only
      if (i === 4) {
        await expect(items(page)).toHaveCount(2);
        await expect(items(page).nth(0)).toContainText("garden sensor");
        await expect(items(page).nth(1)).toContainText("recipe wiki");
      }
    }
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText("Nationality");
    await expect(primary(page)).toHaveText("Finish my profile");
  });
});
