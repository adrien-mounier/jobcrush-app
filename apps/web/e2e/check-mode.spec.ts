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
  // #379: the words door — the server trims and stores them; a re-read shows them.
  await page.route("**/api/cv/lines/*/text", async (route) => {
    record(route);
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const text = (route.request().postDataJSON() as { text: string }).text.trim();
    swapLine(id, { text });
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
