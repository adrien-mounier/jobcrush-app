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
  letterhead: {
    name: { value: "Jane Doe", origin: "read" },
    title: { value: "IT Project Manager", origin: "read" },
    email: { value: "jane.doe@example.com", origin: "read" },
    phone: { value: "+33 6 00 00 00 00", origin: "read" },
    location: { value: "Paris, France", origin: "read" },
  },
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
    // #376: the server refuses first while a target market has no work-rights answer.
    const unset = box.state.workRights.filter((r) => r.answer === null).map((r) => r.market);
    if (unset.length > 0)
      return route.fulfill({ status: 409, json: { error: { code: "work_rights_unset", message: `Tell me if you can work in ${unset.join(" and ")} first.` } } });
    // #378/#380: the server refuses while a suggestion of either kind is unanswered.
    const open = box.state.sections.some((s) =>
      ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines).some((l) => l.state === "drafted" || l.state === "removal-suggested"),
    );
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
  // #379: the words door — the server trims and stores them; a re-read shows them.
  await page.route("**/api/cv/lines/*/text", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const text = (route.request().postDataJSON() as { text: string }).text.trim();
    move(id, { text });
    await route.fulfill({ json: { id, text } });
  });
  // #381: Your details' batched save — each non-empty field becomes the person's own answer.
  await page.route("**/api/contact", async (route) => {
    record(route);
    const { fields } = route.request().postDataJSON() as { fields: Record<string, string> };
    const letterhead = { ...box.state.letterhead };
    for (const [field, value] of Object.entries(fields)) {
      if (value) letterhead[field as keyof typeof letterhead] = { value, origin: "person-said" };
    }
    box.state = { ...box.state, letterhead };
    await route.fulfill({ json: letterhead });
  });
  // #376: a work-rights tap stores that row's answer; the languages card stores the whole list.
  await page.route("**/api/review/work-rights/*", async (route) => {
    record(route);
    const itemId = lineIdOf(route);
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

// #381 (ADR-0018 clause 5): Your details are the person's own facts, shown as five editable fields
// in a plain card; the footer button saves what changed, and typing survives moving around.
test.describe("#381 Your details as editable fields", () => {
  const FIELDS = ["name", "title", "email", "phone", "location"] as const;
  const field = (page: Page, name: (typeof FIELDS)[number]) => page.locator(`.card.form .fields input[name=${name}]`);
  const contactCalls = (calls: Recorded[]) => calls.filter((c) => c.url === "/api/contact");

  test("the five fields arrive filled from the letterhead, in a plain card with no button of its own", async ({ page }) => {
    await stubReview(page);
    await page.goto("/profile/check");
    await expect(heading(page)).toHaveText(SCREENS[0]!);
    const values = await Promise.all(FIELDS.map((f) => field(page, f).inputValue()));
    expect(values).toEqual(FIELDS.map((f) => REVIEW.letterhead[f]!.value));
    // Every field is labelled (the label wraps its input), and the card holds no button: the footer saves.
    for (const f of FIELDS) await expect(page.locator(`.card.form .fields label:has(input[name=${f}])`)).toHaveCount(1);
    await expect(page.locator(".card.form button")).toHaveCount(0);
    await expect(page.locator(".card.form")).toHaveCount(1);
  });

  test("a CV with no location shows the empty field with its placeholder, and the screen still confirms without a save", async ({ page }) => {
    const { calls } = await stubReview(page, { ...REVIEW, letterhead: { ...REVIEW.letterhead, location: null } });
    await page.goto("/profile/check");
    await expect(field(page, "location")).toHaveValue("");
    // Same placeholder as any empty field would carry; the filled name carries it too, unseen.
    const placeholder = await field(page, "location").getAttribute("placeholder");
    expect(placeholder?.length).toBeGreaterThan(0);
    await expect(field(page, "name")).toHaveAttribute("placeholder", placeholder!);
    await expect(primary(page)).toBeEnabled();
    await primary(page).click();
    await expect(heading(page)).toHaveText(SCREENS[1]!);
    expect(contactCalls(calls)).toEqual([]); // nothing was changed, so nothing is written
  });

  test("editing a field and pressing Next saves it — only what changed — and a reload shows it", async ({ page }) => {
    const { calls } = await stubReview(page);
    await page.goto("/profile/check");
    await field(page, "title").fill("Head of Delivery");
    await field(page, "location").fill("Lyon, France");
    await primary(page).click();
    await expect(heading(page)).toHaveText(SCREENS[1]!);
    expect(contactCalls(calls)).toEqual([
      { method: "PUT", url: "/api/contact", body: { fields: { title: "Head of Delivery", location: "Lyon, France" } } },
    ]);

    await page.reload();
    await expect(heading(page)).toHaveText(SCREENS[0]!);
    await expect(field(page, "title")).toHaveValue("Head of Delivery");
    await expect(field(page, "location")).toHaveValue("Lyon, France");
    await expect(field(page, "name")).toHaveValue("Jane Doe");
  });

  test("typed text survives the walk's re-reads and Back, until the footer button saves it", async ({ page }) => {
    // The run is going, so the walk re-reads the paper every few seconds — typing must outlive it.
    const { calls, box } = await stubReview(page, { ...REVIEW, progress: { done: 1, total: 2, minutesLeft: 4 } });
    await page.goto("/profile/check");
    await expect(field(page, "name")).toHaveValue("Jane Doe");
    await field(page, "name").fill("Jane Doe-Martin");
    await page.waitForResponse((r) => new URL(r.url()).pathname === "/api/review");
    await expect(field(page, "name")).toHaveValue("Jane Doe-Martin");
    expect(box.state.letterhead.name?.value).toBe("Jane Doe"); // not saved yet

    await primary(page).click();
    await expect(heading(page)).toHaveText(SCREENS[1]!);
    await back(page).click();
    await expect(heading(page)).toHaveText(SCREENS[0]!);
    await expect(field(page, "name")).toHaveValue("Jane Doe-Martin");
    await field(page, "phone").fill("+33 6 11 11 11 11");
    await primary(page).click(); // the footer button saves again: only the new change
    await expect(heading(page)).toHaveText(SCREENS[1]!);
    expect(contactCalls(calls).map((c) => c.body)).toEqual([
      { fields: { name: "Jane Doe-Martin" } },
      { fields: { phone: "+33 6 11 11 11 11" } },
    ]);
  });
});

// #380 "Remove this?" (ADR-0018 clause 4): an item the review proposes to remove — one that belongs
// nowhere, here a date of birth — shows where it sits as a coral card, never the dashed gold frame.
// It holds the screen's button until answered: Remove it sends the removal and lists the item under
// the removed count, where Put back works; Keep it sends it back in as an ordinary item.
test.describe("#380 a removal suggestion", () => {
  const DOB = "Date of birth: 12 March 1985.";
  const WHY = "A date of birth hurts on any CV.";
  const suggested = (id: string, text: string) => line(id, text, { state: "removal-suggested", suggestion: { kind: "personal-data", reason: WHY } });
  const withRemoval = (lines: ReviewLine[]): ReviewState => ({
    ...REVIEW,
    sections: [...REVIEW.sections, { tag: "additional", heading: "Additional Information", lines }],
  });
  const card = (page: Page) => page.locator("li.sg.rmv");
  /** The Additional information screen: the last one, after REVIEW's own screens. */
  async function toAdditional(page: Page) {
    await page.goto("/profile/check");
    for (let i = 0; i < SCREENS.length; i++) await primary(page).click();
    await expect(heading(page)).toHaveText("Additional information");
  }

  test("the card sits where the item does, coral and never dashed, with its reason; it holds the button until answered; Remove it lists the item as removed and Put back restores it", async ({ page }) => {
    const { calls } = await stubReview(page, withRemoval([line("a1", "Nationality: Polish, based in Warsaw."), suggested("a2", DOB)]));
    await toAdditional(page);

    // In place, after the item before it; the item itself is not an ordinary line.
    await expect(items(page)).toHaveCount(1);
    await expect(card(page)).toHaveCount(1);
    expect(await page.locator("ul.pts > li").evaluateAll((els) => els.map((el) => el.className))).toEqual(["pt", "sg rmv"]);
    await expect(card(page).locator(".hd")).toHaveText("Suggestion · Remove this?");
    await expect(card(page).locator(".stxt")).toHaveText(`To remove: ${DOB}`);
    await expect(card(page).locator(".meta")).toHaveText(`Why: ${WHY}`);
    await expect(card(page).locator(".mark.minus svg")).toHaveCount(1);
    // Coral: a solid left bar, no dashed frame, a wavy underline under the text.
    const look = await card(page).evaluate((el) => {
      const s = getComputedStyle(el);
      const t = getComputedStyle(el.querySelector(".stxt")!);
      return { left: s.borderLeftStyle, leftColour: s.borderLeftColor, top: s.borderTopStyle, underline: t.textDecorationLine, wavy: t.textDecorationStyle };
    });
    expect(look).toEqual({ left: "solid", leftColour: "rgb(224, 135, 108)", top: "none", underline: "underline", wavy: "wavy" });
    // It holds the button, by name.
    await expect(primary(page)).toBeDisabled();
    await expect(primary(page)).toHaveText("Answer the suggestion to continue");

    await card(page).locator(".row button:not(.ghost)").click(); // Remove it
    expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/a2", body: { state: "kept" } }]);
    await expect(card(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(1);
    await expect(primary(page)).toBeEnabled();
    await expect(primary(page)).toHaveText("Finish my profile");
    const count = tray(page).getByRole("button", { expanded: false });
    await expect(count).toHaveText("1 removed · Show");
    await count.click();
    await expect(tray(page).locator("s")).toHaveText(DOB);
    await tray(page).locator("li button").click(); // Put back
    expect(calls[1]).toEqual({ method: "PUT", url: "/api/cv/lines/a2", body: { state: "ticked" } });
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).nth(1)).toContainText(DOB);
    await expect(tray(page)).toHaveCount(0);
  });

  test("Keep it sends the item back in as an ordinary item, and the button lets the person through", async ({ page }) => {
    const { calls } = await stubReview(page, withRemoval([suggested("a2", DOB)]));
    await toAdditional(page);
    await expect(items(page)).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();

    await card(page).locator(".row .ghost").click(); // Keep it
    expect(calls).toEqual([{ method: "PUT", url: "/api/cv/lines/a2", body: { state: "ticked" } }]);
    await expect(card(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText(DOB);
    await expect(tray(page)).toHaveCount(0);
    await expect(primary(page)).toBeEnabled();
  });

  test("two open suggestions are named in the plural, and the lead counts them", async ({ page }) => {
    await stubReview(page, withRemoval([suggested("a2", DOB), suggested("a3", "Marital status: married.")]));
    await toAdditional(page);
    await expect(card(page)).toHaveCount(2);
    await expect(primary(page)).toHaveText("Answer the suggestions to continue");
    await expect(page.locator(".lead")).toHaveText(/^2 suggestions/);
    // A screen with nothing to answer says so.
    await back(page).click();
    await expect(page.locator(".lead")).toHaveText(/^Nothing to answer here/);
  });
});

// #379 (ADR-0018 clause 2): an item's words edited in place. ✎ (the item's non-removing action)
// turns the item into a text box with Save / Cancel; the item stays where it is. Selected by
// structure: `li.pt.edit`, its textarea, its primary (Save) and ghost (Cancel) buttons.
test.describe("#379 edit an item's words in place", () => {
  const editButton = (item: ReturnType<Page["locator"]>) => item.locator(".ib:not(.rmv)");
  const editor = (page: Page) => page.locator("li.pt.edit");
  const textbox = (page: Page) => editor(page).locator("textarea");
  const TEXT_CALL = (id: string, text: string) => ({ method: "PUT", url: `/api/cv/lines/${id}/text`, body: { text } });

  async function toNordic(page: Page) {
    await page.goto("/profile/check");
    await primary(page).click();
    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");
  }

  test("✎ opens the editor; Enter saves the words and the item keeps its place with them across a reload; Escape cancels and sends nothing; an empty save is refused", async ({ page }) => {
    const { calls } = await stubReview(page);
    await toNordic(page);
    const first = items(page).first();
    await first.hover();
    await editButton(first).click();
    await expect(editor(page)).toHaveCount(1);
    await expect(textbox(page)).toHaveValue("Led the checkout replatform.");
    await expect(textbox(page)).toBeFocused();

    await textbox(page).fill("Led the checkout replatform for 12 stores.");
    await page.keyboard.press("Enter");
    expect(calls).toEqual([TEXT_CALL("nrg-1", "Led the checkout replatform for 12 stores.")]);
    await expect(editor(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).first()).toContainText("Led the checkout replatform for 12 stores."); // still first
    await page.reload();
    await toNordic(page);
    await expect(items(page).first()).toContainText("Led the checkout replatform for 12 stores.");

    // Cancel: typed words are dropped, nothing is sent.
    const second = items(page).nth(1);
    await second.hover();
    await editButton(second).click();
    await textbox(page).fill("Something else entirely.");
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    expect(calls).toHaveLength(1);
    await expect(items(page).nth(1)).toContainText("Managed a budget of EUR 1.2M");

    // Empty: Save is held and Enter sends nothing; the words stay.
    await second.hover();
    await editButton(second).click();
    await textbox(page).fill("   ");
    await expect(editor(page).locator(".btn.primary")).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(calls).toHaveLength(1);
    await expect(editor(page)).toHaveCount(1);
    await editor(page).locator(".btn.ghost").click();
    await expect(items(page).nth(1)).toContainText("Managed a budget of EUR 1.2M");
  });

  test("by keyboard: focus on the item's ✎ shows the actions, Enter opens the editor with the text box focused, Enter saves", async ({ page }) => {
    const { calls } = await stubReview(page);
    await toNordic(page);
    const first = items(page).first();
    await expect(first.locator(".acts")).toHaveCSS("opacity", "0");
    await editButton(first).focus();
    await expect(first.locator(".acts")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(textbox(page)).toBeFocused();
    await textbox(page).fill("Led the checkout replatform, on time.");
    await page.keyboard.press("Enter");
    expect(calls).toEqual([TEXT_CALL("nrg-1", "Led the checkout replatform, on time.")]);
    await expect(items(page).first()).toContainText("Led the checkout replatform, on time.");
  });

  test.describe("by tap", () => {
    test.use({ hasTouch: true });
    test("a tap on the item shows ✎, a tap on it opens the editor, a tap on Save sends the words", async ({ page }) => {
      const { calls } = await stubReview(page);
      await toNordic(page);
      const first = items(page).first();
      await first.locator(".txt").tap();
      await expect(first).toHaveClass(/\bact\b/);
      await editButton(first).tap();
      await expect(editor(page)).toHaveCount(1);
      await textbox(page).fill("Led the checkout replatform, tapped.");
      await editor(page).locator(".btn.primary").tap();
      expect(calls).toEqual([TEXT_CALL("nrg-1", "Led the checkout replatform, tapped.")]);
      await expect(items(page).first()).toContainText("Led the checkout replatform, tapped.");
    });
  });

  test("every section's items offer ✎ except About you, whose editing is its own (#371)", async ({ page }) => {
    await stubReview(page);
    await page.goto("/profile/check");
    await primary(page).click();
    await expect(heading(page)).toHaveText("About you");
    await expect(items(page).locator(".ib.rmv")).toHaveCount(1);
    await expect(items(page).locator(".ib:not(.rmv)")).toHaveCount(0);
    for (const title of ["Nordic Retail Group", "Baltic Software House", "Skills", "Education"]) {
      await primary(page).click();
      await expect(heading(page)).toHaveText(title);
      await expect(items(page).first().locator(".ib:not(.rmv)")).toHaveCount(1);
    }
  });

  test("Personal projects and Additional information items offer ✎ too, and save through the same door", async ({ page }) => {
    const { calls } = await stubReview(page, {
      ...REVIEW,
      sections: [
        ...REVIEW.sections,
        { tag: "project", heading: "Personal Projects", lines: [line("pr1", "Built a garden sensor network.")] },
        { tag: "additional", heading: "Additional Information", lines: [line("ad1", "Nationality: Portuguese")] },
      ],
    });
    await page.goto("/profile/check");
    // Personal projects is the 7th screen here (after SCREENS' six), Additional information the 8th.
    for (let i = 1; i < SCREENS.length; i++) await primary(page).click();
    for (const [title, id] of [["Personal projects", "pr1"], ["Additional information", "ad1"]] as const) {
      await primary(page).click();
      await expect(heading(page)).toHaveText(title);
      const first = items(page).first();
      await first.hover();
      await editButton(first).click();
      await textbox(page).fill(`Edited ${id}.`);
      await page.keyboard.press("Enter");
      await expect(items(page).first()).toContainText(`Edited ${id}.`);
    }
    expect(calls).toEqual([TEXT_CALL("pr1", "Edited pr1."), TEXT_CALL("ad1", "Edited ad1.")]);
  });
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
  const TITLES_WITH_PROJECTS = ["Your details", "About you", "Nordic Retail Group", "Baltic Software House", "Personal projects", "Skills", "Education", "Languages", "Additional information"];

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
