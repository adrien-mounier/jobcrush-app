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
  movedFrom: null,
  ...over,
});

const REVIEW: ReviewState = {
  completed: false,
  letterhead: { header: "Jane Doe\nParis, France", phone: { value: "+33 6 00 00 00 00", origin: "read" }, email: { value: "jane.doe@example.com", origin: "read" } },
  conflict: null,
  progress: null,
  unchecked: false,
  about: null,
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
  await page.route("**/api/review/complete", async (route) => {
    record(route);
    box.state = { ...box.state, completed: true };
    await route.fulfill({ json: { completed: true } });
  });
  const swapLine = (id: string, over: Partial<ReviewLine>) => {
    const swap = (l: ReviewLine) => (l.id === id ? { ...l, ...over } : l);
    box.state = {
      ...box.state,
      sections: box.state.sections.map((s) =>
        "jobs" in s ? { ...s, jobs: s.jobs.map((j) => ({ ...j, lines: j.lines.map(swap) })) } : { ...s, lines: s.lines.map(swap) },
      ),
    };
  };
  await page.route("**/api/cv/lines/*", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const { state } = route.request().postDataJSON() as { state: ReviewLine["state"] };
    swapLine(id, { state });
    await route.fulfill({ json: { id, state } });
  });
  // #371: About you's footer save — the saved words read back on the next GET /review.
  await page.route("**/api/review/about", async (route) => {
    record(route);
    const { text } = route.request().postDataJSON() as { text: string };
    box.state = { ...box.state, about: { text, original: box.state.about?.original ?? null } };
    await route.fulfill({ json: { text } });
  });
  // #379: the words door — the server trims and stores them; a re-read shows them.
  await page.route("**/api/cv/lines/*/text", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const text = (route.request().postDataJSON() as { text: string }).text.trim();
    swapLine(id, { text });
    await route.fulfill({ json: { id, text } });
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

// #371 About you (ADR-0018 clause 5): the text the review wrote from the whole CV, in a plain card
// with "Edit it" and "See what your CV said"; the footer button keeps it or saves the person's words;
// a summary fact moved to another section wears where it came from, and can be removed like any item.
test.describe("#371 About you", () => {
  const ABOUT = {
    text: "Led the checkout replatform. Coordinated releases for 4 agile squads.",
    original: "Delivery-accountable project manager.\nFluent in French and English.",
  };
  const WITH_ABOUT: ReviewState = { ...REVIEW, about: ABOUT };
  const card = (page: Page) => page.locator(".card.form");
  const original = (page: Page) => card(page).locator("button.linkbtn[aria-expanded]");

  test("the screen shows the text in a plain card; See what your CV said shows the original read-only; the footer keeps the text unchanged", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_ABOUT);
    await page.goto("/profile/check");
    await primary(page).click();
    await expect(heading(page)).toHaveText("About you");
    await expect(card(page).locator(".about")).toHaveText(ABOUT.text);
    // A plain card: no suggestion frame, no item list, no tick box.
    await expect(page.locator(".sg, li.pt, input[type=checkbox]")).toHaveCount(0);
    await expect(card(page).locator(".orig")).toHaveCount(0);
    await expect(original(page)).toHaveAttribute("aria-expanded", "false");
    await original(page).click();
    await expect(original(page)).toHaveAttribute("aria-expanded", "true");
    await expect(card(page).locator(".orig p")).toHaveText(ABOUT.original);
    await expect(card(page).locator(".orig textarea, .orig input")).toHaveCount(0);
    await original(page).click();
    await expect(card(page).locator(".orig")).toHaveCount(0);

    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");
    expect(calls).toEqual([{ method: "PUT", url: "/api/review/about", body: { text: ABOUT.text } }]);
  });

  test("Edit it opens the text; the footer saves the person's words, which read back after a reload; Undo my changes puts the text back", async ({ page }) => {
    const { calls } = await stubReview(page, WITH_ABOUT);
    await page.goto("/profile/check");
    await primary(page).click();
    await card(page).locator("button.btn").click(); // Edit it
    const box = card(page).locator("textarea");
    await expect(box).toHaveValue(ABOUT.text);
    await expect(box).toBeFocused();
    await box.fill("Something else.");
    await card(page).locator("button.btn.ghost").click(); // Undo my changes
    await expect(card(page).locator("textarea")).toHaveCount(0);
    await expect(card(page).locator(".about")).toHaveText(ABOUT.text);

    await card(page).locator("button.btn").click();
    const mine = "Led the checkout replatform at Nordic Retail Group, managing EUR 1.2M across three vendor teams.";
    await card(page).locator("textarea").fill(`  ${mine}  `);
    await primary(page).click();
    await expect(heading(page)).toHaveText("Nordic Retail Group");
    expect(calls).toEqual([{ method: "PUT", url: "/api/review/about", body: { text: mine } }]);

    await page.reload();
    await primary(page).click();
    await expect(heading(page)).toHaveText("About you");
    await expect(card(page).locator(".about")).toHaveText(mine);
    await original(page).click();
    await expect(card(page).locator(".orig p")).toHaveText(ABOUT.original);
  });

  test("a CV with no summary still gets the screen, with nothing to show as the original", async ({ page }) => {
    const noSummary: ReviewState = {
      ...REVIEW,
      about: { text: ABOUT.text, original: null },
      sections: REVIEW.sections.map((s) => (s.tag === "profile" ? { ...s, lines: [] } : s)),
    };
    await stubReview(page, noSummary);
    await page.goto("/profile/check");
    await primary(page).click();
    await expect(heading(page)).toHaveText("About you");
    await expect(card(page).locator(".about")).toHaveText(ABOUT.text);
    await expect(original(page)).toHaveCount(0);
    await expect(card(page).locator("button.btn")).toHaveCount(1); // Edit it is still there
  });

  test("a fact moved from the summary sits in its new section with its tag, and is removed like any item", async ({ page }) => {
    const moved: ReviewState = {
      ...WITH_ABOUT,
      sections: REVIEW.sections.map((s) => (s.tag === "lang" ? { ...s, lines: [line("sum-langs", "Fluent in French and English.", { movedFrom: "your summary" })] } : s)),
    };
    const { calls } = await stubReview(page, moved);
    await page.goto("/profile/check");
    for (let i = 0; i < SCREENS.length; i++) await primary(page).click();
    await expect(heading(page)).toHaveText("Languages");
    const item = items(page).first();
    await expect(item.locator(".txt")).toContainText("Fluent in French and English.");
    await expect(item.locator(".tag.moved")).toHaveText("Moved from your summary");
    // A line that never moved wears no tag.
    await back(page).click();
    await expect(items(page).first()).toBeVisible();
    await expect(items(page).locator(".tag")).toHaveCount(0);
    await primary(page).click();
    await item.hover();
    await removeButton(item).click();
    expect(calls.at(-1)).toEqual({ method: "PUT", url: "/api/cv/lines/sum-langs", body: { state: "kept" } });
    await expect(items(page)).toHaveCount(0);
    await expect(tray(page)).toHaveCount(1);
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
