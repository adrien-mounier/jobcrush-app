import { expect, test, type Page } from "@playwright/test";
import type { ProfileState } from "../lib/api";

// #20 the profile screen (Sorted + Constellation), under the colour law: gold = on the CV right now,
// grey = saved in reserve — never presented as a lack. Route-mocked to the pinned ProfileState shape
// (the backend for GET /profile may not be wired when this runs, matching discovery.spec.ts's own
// assumption). Not testing the Constellation canvas's visual craft — only that the screen loads, the
// toggle switches views, both colour states render with source as neutral text, and every fact is
// reachable by keyboard through the accessible list.
//
// #183 adds desktop shape A (field + right rail) and the rail's Job family panel — see
// design-183-desktop-profile-shape-a.md. Its own tests are grouped below the original ones.

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

type Fact = ProfileState["domains"][number]["facts"][number];

// #186 review round 2 — the eligibility store's own languages question, always present on the
// payload. `answer: null` is the safe default for every fixture that doesn't touch languages; the
// dedicated language-door tests below override it (and `domains`) per case.
const LANGUAGES_QUESTION: ProfileState["languagesQuestion"] = {
  questionId: "eligibility-languages",
  question: "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.",
  consequence:
    "A no takes jobs that require that language out of your deck. Tick every one you could run a meeting in. Not sure? Tick it.",
  options: ["English", "Mandarin", "Cantonese", "Vietnamese", "Ask me later"],
  answer: null,
};

const PROFILE: ProfileState = {
  factCount: 4,
  search: { role: "IT project manager in Paris", family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: "experience",
      heading: "Professional Experience",
      facts: [
        { id: "e1", text: "Managed a team of six engineers.", colour: "gold", source: "told", job: null },
        {
          id: "e2",
          text: "Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.",
          colour: "grey",
          source: "read",
          job: null,
        },
        { id: "e3", text: "Led SAP cutover planning.", colour: "grey", source: "told", job: null },
      ],
    },
    {
      tag: "skill",
      heading: "Skills",
      facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told", job: null }],
    },
  ],
  contact: { phone: null, email: null }, // #190's honest-absence default; populated fixtures below
  location: { area: null, workRights: null }, // #188's rail — types mirrored only, not this ticket's UI
  languagesQuestion: LANGUAGES_QUESTION,
};

async function stubProfile(page: Page, state: ProfileState = PROFILE) {
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: state });
  });
}

test("the screen loads with groups in payload order, About you first, experience facts as full rows", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);

  await page.goto("/profile");

  const heading = page.getByRole("heading", { name: "4 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  // About you (#190/#186 merge) always leads; the payload's own order is drawn as-is (this fixture's
  // order happens to also be size order — the dedicated CV-order test below uses a fixture where the
  // two would disagree, to prove the client-side size-sort is really gone from Sorted).
  const domainNames = page.locator(".dname");
  await expect(domainNames).toHaveCount(3);
  await expect(domainNames.nth(0)).toHaveText("About you");
  await expect(domainNames.nth(1)).toHaveText("Professional Experience");
  await expect(domainNames.nth(2)).toHaveText("Skills");

  // #186 A2/A3: experience facts render as full sentence rows (never chips), gold before grey.
  const firstRow = page.locator(".frow").first();
  await expect(firstRow).toHaveText("Managed a team of six engineers.");
  await expect(firstRow).toHaveClass(/gold/);
  await expect(page.locator(".frow.grey")).toHaveCount(2);
});

test("the toggle switches Sorted and Constellation under one colour law", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const sortedBtn = page.getByRole("button", { name: "Sorted" });
  const constellationBtn = page.getByRole("button", { name: "Constellation" });
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "true");

  await constellationBtn.click();
  await expect(constellationBtn).toHaveAttribute("aria-pressed", "true");
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".sky")).toBeVisible();
  await expect(page.getByText("Constellation view")).toBeAttached(); // the live-region announcement

  await sortedBtn.click();
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sheetwrap")).toBeVisible();
});

test("both colours render, and source is neutral text — never a colour, never a lacks list", async ({ page }) => {
  await stubSession(page);
  // A local fixture (not the shared PROFILE) so the extra grey chip doesn't ripple into other tests
  // that count total facts (e.g. the keyboard-reachability test's Constellation star count).
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      PROFILE.domains[0],
      {
        ...PROFILE.domains[1],
        facts: [...PROFILE.domains[1].facts, { id: "s2", text: "Excel.", colour: "grey", source: "read", job: null }],
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  // A gold fact and a grey fact both render as fact chips in Sorted (Skills is a chip section).
  await expect(page.locator(".fact.gold").first()).toBeVisible();
  await expect(page.locator(".fact.grey").first()).toBeVisible();

  // Opening a grey (reserve) fact shows the neutral "read from CV" source line, never styled as a gap.
  const greyFact = page.locator(".fact.grey").first();
  await greyFact.click();
  const dialog = page.locator("dialog.detail");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Saved to your profile")).toBeVisible();
  await expect(dialog.getByText(/told me this|Read from your CV/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(greyFact).toBeFocused();

  // No "what you lack" list anywhere on the page.
  await expect(page.getByText(/lack/i)).toHaveCount(0);
});

test("the Sorted detail dialog returns focus to the opener after Escape", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const fact = page.getByRole("button", { name: /Led SAP cutover planning/ });
  await fact.focus();
  await page.keyboard.press("Enter");

  const dialog = page.locator("dialog.detail");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(fact).toBeFocused();
});

test("every fact is reachable by keyboard, including in Constellation", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Constellation" }).click();

  const stars = page.locator(".skylist button");
  await expect(stars).toHaveCount(4);

  // Tabbing to each visible star button opens its detail sheet — the canvas's keyboard equivalent.
  for (let i = 0; i < (await stars.count()); i++) {
    await expect(stars.nth(i)).toBeVisible();
    await stars.nth(i).focus();
    await expect(stars.nth(i)).toBeFocused();
  }
  await expect(page.locator(".sheet.in")).toBeVisible();
});

// ---------- #183 desktop shape A: field + right rail, hero, Job family ----------

test("desktop: the field and rail render side by side, and the Sorted/Constellation toggle still works", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const field = page.locator(".field");
  const rail = page.locator(".rail");
  await expect(field).toBeVisible();
  await expect(rail).toBeVisible();

  const fieldBox = await field.boundingBox();
  const railBox = await rail.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  // Side by side: the rail starts at/after the field's right edge, not below it.
  expect(railBox!.x).toBeGreaterThan(fieldBox!.x + fieldBox!.width - 20);
  expect(Math.abs(railBox!.y - fieldBox!.y)).toBeLessThan(60);

  const constellationBtn = page.getByRole("button", { name: "Constellation" });
  await constellationBtn.click();
  await expect(constellationBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sky")).toBeVisible();
  await expect(rail).toBeVisible(); // the rail survives the view switch
});

test("desktop: clicking a view toggle never touches the sheet — no announcement, no sheet state or landmark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Constellation" }).click();
  await expect(page.locator(".sky")).toBeVisible();

  // Code review MUST-FIX: the sheet must not leak onto desktop — no announcement, no `.open` class,
  // no phantom "Your facts" landmark surviving `display: contents`.
  await expect(page.getByText("Your facts opened.")).toHaveCount(0);
  await expect(page.getByText("Your facts closed.")).toHaveCount(0);
  await expect(page.locator(".pfsheet")).not.toHaveClass(/open/);
  await expect(page.locator(".pfsheet")).not.toHaveAttribute("role", "region");
  await expect(page.getByRole("region", { name: "Your facts" })).toHaveCount(0);
});

// ---------- #192 phone: the rail leads, the facts open as a pull-up sheet ----------
// Supersedes #183's interim phone stacking (facts first, rail below). See design-192.md.

test("phone: the rail leads, and the facts sheet sits collapsed with a visible grabber and count", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  // Hero and rail are both visible without opening the sheet.
  await expect(page.getByRole("heading", { name: "4 things you've told me" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Not the job you meant?" })).toBeVisible();

  const grab = page.getByRole("button", { name: /Your facts/ });
  await expect(grab).toBeVisible();
  await expect(grab).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".pfnum")).toContainText("4");

  // Collapsed: the field's own content is out of the tab order / a11y tree — no JS viewport check.
  await expect(page.locator("#profileview")).not.toBeVisible();
});

test("phone: tapping the grabber expands the sheet with the Sorted/Constellation toggle fully working", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const grab = page.getByRole("button", { name: /Your facts/ });
  await grab.click();

  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".pfsheet")).toHaveClass(/open/);
  await expect(page.locator("#profileview")).toBeVisible();
  await expect(page.getByText("Your facts opened.")).toBeAttached();

  // The toggle still works fully while expanded.
  const constellationBtn = page.getByRole("button", { name: "Constellation" });
  await constellationBtn.click();
  await expect(constellationBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sky")).toBeVisible();

  const sortedBtn = page.getByRole("button", { name: "Sorted" });
  await sortedBtn.click();
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sheetwrap")).toBeVisible();
});

test("phone: activating the grabber by keyboard expands the sheet, focus staying on the grabber", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const grab = page.getByRole("button", { name: /Your facts/ });
  await grab.focus();
  await page.keyboard.press("Enter");

  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#profileview")).toBeVisible();
  // Standard disclosure behaviour: no focus jump into the content.
  await expect(grab).toBeFocused();
});

test("phone: tapping a view toggle while collapsed opens the sheet and switches the view together", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const grab = page.getByRole("button", { name: /Your facts/ });
  await expect(grab).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "Constellation" }).click();

  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".sky")).toBeVisible();
});

test("phone: a fact's detail dialog opens and closes correctly inside the expanded sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: /Your facts/ }).click();
  const fact = page.getByRole("button", { name: /Led SAP cutover planning/ });
  await fact.click();

  const dialog = page.locator("dialog.detail");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(fact).toBeFocused();
  // The dialog's own Escape must not also collapse the sheet behind it (§3.2 rule 1).
  await expect(page.locator(".pfsheet")).toHaveClass(/open/);
});

test("phone: collapsing the sheet again restores the rail view", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const grab = page.getByRole("button", { name: /Your facts/ });
  await grab.click();
  await expect(grab).toHaveAttribute("aria-expanded", "true");

  await grab.click();
  await expect(grab).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#profileview")).not.toBeVisible();
  await expect(page.getByText("Your facts closed.")).toBeAttached();
  await expect(page.getByRole("button", { name: "Not the job you meant?" })).toBeVisible();
});

test("phone: a real pull gesture past the threshold expands the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const grab = page.getByRole("button", { name: /Your facts/ });
  const box = await grab.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 8 }); // well past the 56px open threshold
  await page.mouse.up();

  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#profileview")).toBeVisible();

  // QA regression guard: drag it back down, then the grabber must still be keyboard-operable — a
  // shipped bug left `draggedRef` stuck true after any drag, going permanently keyboard-dead.
  // The grabber moved when the sheet opened, so re-read its position — stale coordinates land the
  // second gesture on the sheet body. Wait until it has genuinely arrived (well above the collapsed
  // position) AND stopped moving: a read mid-transition yields a coordinate it is about to leave.
  let openBox: Awaited<ReturnType<typeof grab.boundingBox>> = null;
  await expect(async () => {
    const a = await grab.boundingBox();
    expect(a).not.toBeNull();
    expect(a!.y).toBeLessThan(y - 200);
    await page.waitForTimeout(100);
    const b = await grab.boundingBox();
    expect(b!.y).toBe(a!.y);
    openBox = b;
  }).toPass({ timeout: 5000 });
  expect(openBox).not.toBeNull();
  const ox = openBox!.x + openBox!.width / 2;
  const oy = openBox!.y + openBox!.height / 2;
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  await page.mouse.move(ox, oy + 80, { steps: 8 }); // well past the 56px close threshold
  await page.mouse.up();
  await expect(grab).toHaveAttribute("aria-expanded", "false");

  await grab.focus();
  await page.keyboard.press("Enter");
  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#profileview")).toBeVisible();
});

test("phone: a contact door opens correctly from inside the expanded sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    contact: { phone: { value: "+852 1234 5678", origin: "read" }, email: null },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await page.getByRole("button", { name: /Your facts/ }).click();
  const about = page.locator(".dom").filter({ hasText: "About you" });
  await about.getByRole("button", { name: "Not your number?" }).click();

  const input = page.getByLabel("What's the best phone number for your CV?");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("+852 1234 5678");
});

test("phone: Escape inside a door's question closes only the question — the sheet stays open, focus on the door", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    contact: { phone: { value: "+852 1234 5678", origin: "read" }, email: null },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await page.getByRole("button", { name: /Your facts/ }).click();
  const about = page.locator(".dom").filter({ hasText: "About you" });
  const door = about.getByRole("button", { name: "Not your number?" });
  await door.click();

  const input = page.getByLabel("What's the best phone number for your CV?");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");

  // QA fix: one layer of Escape closes the question — it must not also fall through to the page-
  // level handler and collapse the sheet out from under it.
  await expect(input).toHaveCount(0);
  await expect(door).toBeFocused();
  await expect(page.locator(".pfsheet")).toHaveClass(/open/);
  await expect(page.locator("#profileview")).toBeVisible();

  // A second Escape, now that focus is back on the door (outside any question), does collapse it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".pfsheet")).not.toHaveClass(/open/);
});

test("phone at 360×800: 'Not the job you meant?' is visible without any scrolling or sheet occlusion (AC3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const door = page.getByRole("button", { name: "Not the job you meant?" });
  await expect(door).toBeVisible();
  const box = await door.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);

  // Not occluded by the collapsed sheet's own visible edge either — the door's bottom must clear
  // the peek, not just the viewport.
  const headBox = await page.locator(".pfsheet-head").boundingBox();
  expect(headBox).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(headBox!.y);

  const scrollTop = await page.locator(".stage").evaluate((el) => el.scrollTop);
  expect(scrollTop).toBe(0); // visible at rest, before any scroll happens
});

test("the hero reads the live counts with the 'kept for when a job needs them' framing, no colour name", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    factCount: 24,
    domains: [
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: Array.from<unknown, Fact>({ length: 18 }, (_, i) => ({
          id: `n${i}`,
          text: `Numbered fact ${i}.`,
          colour: "gold",
          source: "told",
          job: null,
        })).concat(
          Array.from<unknown, Fact>({ length: 6 }, (_, i) => ({
            id: `s${i}`,
            text: `Saved fact ${i}.`,
            colour: "grey",
            source: "told",
            job: null,
          })),
        ),
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await expect(page.getByRole("heading", { name: "24 things you've told me" })).toBeVisible();
  await expect(page.locator(".pwait")).toContainText("18");
  await expect(page.locator(".pwait")).toContainText("make your CV right now");
  await expect(page.locator(".pwait")).toContainText("kept for when a job needs them");
  // The hero and the sorted-list note never name a colour — the copy this ticket controls.
  await expect(page.locator(".phead")).not.toContainText(/gold|grey/i);
  await expect(page.locator(".dnote")).not.toContainText(/gold|grey/i);
});

test("Job family renders only the role and the door when family is null — no family name, siblings, or count", async ({
  page,
}) => {
  await stubSession(page);
  await stubProfile(page); // PROFILE.search.family/siblingTitles/openJobs are the pre-E5 empty shape
  await page.goto("/profile");

  const rail = page.locator(".rail");
  await expect(rail.locator(".rrole")).toHaveText("IT project manager in Paris");
  await expect(rail.locator(".rfam")).toHaveCount(0);
  await expect(rail.locator(".rrow")).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "Not the job you meant?" })).toBeVisible();
});

test("the door reopens the original role question pre-filled, and answering it updates the search", async ({ page }) => {
  await stubSession(page);
  let current: ProfileState = PROFILE;
  // Holds the targets PUT open until the test explicitly releases it, so the busy-state assertion
  // below is deterministic rather than racing a fixed delay against CI's own variable speed.
  let releaseSave: () => void = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: current });
  });
  await page.route("**/api/sessions/me/targets", async (route) => {
    await saveGate;
    const body = route.request().postDataJSON() as { targetTitles: string[] };
    current = { ...current, search: { ...current.search, role: body.targetTitles[0] } };
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/profile");

  const door = page.getByRole("button", { name: "Not the job you meant?" });
  await door.click();

  const input = page.getByLabel("What kind of job are you going for?");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("IT project manager in Paris"); // pre-filled with the previous answer

  await input.fill("Delivery manager in Lyon");
  await page.getByRole("button", { name: "That's me" }).click();

  await expect(page.getByText("Finding jobs like yours…")).toBeVisible();
  releaseSave();
  await expect(page.getByText("Now searching Delivery manager in Lyon.")).toBeAttached();
  await expect(page.locator(".rrole")).toHaveText("Delivery manager in Lyon");
  await expect(door).toBeFocused();
});

test("cancelling the door keeps the previous answer and returns focus to the door", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const door = page.getByRole("button", { name: "Not the job you meant?" });
  await door.click();
  const input = page.getByLabel("What kind of job are you going for?");
  await input.fill("Something else entirely");
  await page.getByRole("button", { name: "Keep IT project manager in Paris" }).click();

  await expect(page.locator(".rrole")).toHaveText("IT project manager in Paris");
  await expect(door).toBeFocused();
});

test("a failed save keeps the typed value, focuses the input, and shows a retry error", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.route("**/api/sessions/me/targets", async (route) => {
    await route.fulfill({ status: 500, json: { error: { message: "nope" } } });
  });
  await page.goto("/profile");

  await page.getByRole("button", { name: "Not the job you meant?" }).click();
  const input = page.getByLabel("What kind of job are you going for?");
  await input.fill("Product manager in Berlin");
  await page.getByRole("button", { name: "That's me" }).click();

  const err = page.getByText("Couldn't save that just now. Try again.");
  await expect(err).toBeVisible();
  await expect(input).toHaveValue("Product manager in Berlin");
  await expect(input).toBeFocused();
});

test("when the search block carries a family, siblings, and an open-jobs count, they display (the E5 seam)", async ({
  page,
}) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    search: {
      role: "IT project manager in Paris",
      family: "IT Project Management",
      siblingTitles: ["Programme manager", "Delivery manager"],
      openJobs: 42,
    },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  const rail = page.locator(".rail");
  await expect(rail.locator(".rrole")).toHaveText("IT project manager in Paris");
  await expect(rail.locator(".rfam")).toHaveText("Part of IT Project Management.");
  await expect(rail.locator(".rlabel")).toHaveText("Also searching");
  await expect(rail.locator(".rtag")).toHaveCount(2);
  await expect(rail.locator(".rtag").first()).toHaveText("Programme manager");
  await expect(rail.locator(".rsrc")).toContainText("42 jobs open");
  await expect(rail.locator(".rsrc")).toContainText("across these titles right now.");
  await expect(rail.getByRole("button", { name: "Not the job you meant?" })).toBeVisible();
});

test("role never answered: the door reads its own copy and opens the same question", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = { ...PROFILE, search: { role: null, family: null, siblingTitles: [], openJobs: null } };
  await stubProfile(page, state);
  await page.goto("/profile");

  const rail = page.locator(".rail");
  await expect(rail.locator(".rrole")).toHaveText("You haven't told me yet.");
  const door = rail.getByRole("button", { name: "What job are you looking for?" });
  await expect(door).toBeVisible();

  await door.click();
  await expect(page.getByLabel("What kind of job are you going for?")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
});

// ---------- #190 "contact info is a fact": About you (phone + email) ----------

test("phone and email display in About you, each with its origin shown like a fact's source", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    contact: {
      phone: { value: "+852 1234 5678", origin: "read" },
      email: { value: "person@example.com", origin: "person-said" },
    },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  const about = page.locator(".dom").filter({ hasText: "About you" });
  await expect(about.getByText("Phone", { exact: true })).toBeVisible();
  await expect(about.getByText("+852 1234 5678")).toBeVisible();
  await expect(about.getByText("Read from your CV.")).toBeVisible();
  // The CV email is labelled as what the CV shows — never presented as the account/login email.
  await expect(about.getByText("Email on your CV", { exact: true })).toBeVisible();
  await expect(about.getByText("person@example.com")).toBeVisible();
  await expect(about.getByText("You told me this.")).toBeVisible();
  await expect(about.getByRole("button", { name: "Not your number?" })).toBeVisible();
  await expect(about.getByRole("button", { name: "Not the right email?" })).toBeVisible();
});

test("an absent phone reads as honestly absent, and supplying one flows exactly like a correction", async ({ page }) => {
  await stubSession(page);
  let current: ProfileState = { ...PROFILE, contact: { phone: null, email: null } };
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: current });
  });
  await page.route("**/api/contact", async (route) => {
    const body = route.request().postDataJSON() as { field: "phone" | "email"; value: string };
    current = {
      ...current,
      contact: { ...current.contact, [body.field]: { value: body.value, origin: "person-said" } },
    };
    await route.fulfill({ json: { ...current.contact, phone: { ...current.contact.phone, sourceText: "" } } });
  });
  await page.goto("/profile");

  const about = page.locator(".dom").filter({ hasText: "About you" });
  await expect(about.getByText("Not on your CV")).toHaveCount(2); // neither phone nor email captured yet

  await about.getByRole("button", { name: "What's the best phone number for your CV?" }).click();
  const input = page.getByLabel("What's the best phone number for your CV?");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");

  await input.fill("+852 9876 5432");
  await about.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Phone updated.")).toBeAttached();
  await expect(about.getByText("+852 9876 5432")).toBeVisible();
  await expect(about.getByText("You told me this.")).toBeVisible();
  await expect(about.getByRole("button", { name: "Not your number?" })).toBeFocused();
});

test("the phone door reopens pre-filled with the current value, and cancelling keeps it unchanged", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    contact: { phone: { value: "+852 1234 5678", origin: "read" }, email: null },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  const about = page.locator(".dom").filter({ hasText: "About you" });
  const door = about.getByRole("button", { name: "Not your number?" });
  await door.click();

  const input = page.getByLabel("What's the best phone number for your CV?");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("+852 1234 5678");

  await input.fill("garbage");
  await page.getByRole("button", { name: "Keep +852 1234 5678" }).click();

  await expect(about.getByText("+852 1234 5678")).toBeVisible();
  await expect(door).toBeFocused();
});

test("a refetch failure after a successful contact save is never reported as a save failure", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    contact: { phone: { value: "+852 1234 5678", origin: "read" }, email: null },
  };
  let profileCalls = 0;
  await page.route("**/api/profile", async (route) => {
    profileCalls += 1;
    if (profileCalls === 1) {
      await route.fulfill({ json: state });
      return;
    }
    await route.abort(); // the post-save refetch fails
  });
  await page.route("**/api/contact", async (route) => {
    await route.fulfill({
      json: {
        phone: { value: "+852 9999 0000", origin: "person-said", sourceText: "+852 9999 0000" },
        email: null,
      },
    });
  });
  await page.goto("/profile");

  const about = page.locator(".dom").filter({ hasText: "About you" });
  await about.getByRole("button", { name: "Not your number?" }).click();
  await page.getByLabel("What's the best phone number for your CV?").fill("+852 9999 0000");
  await about.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Couldn't save that just now. Try again.")).toHaveCount(0);
  await expect(page.getByText("Phone updated.")).toBeAttached();
  await expect(about.getByText("+852 9999 0000")).toBeVisible();
  await expect(about.getByText("You told me this.")).toBeVisible();
});

// ---------- #186 the list, style B: CV order, job blocks, chips vs rows, kept captions, the
// languages door, thin/big fixtures ----------

test("#186 AC1: groups render in payload (CV) order, About you merged into one heading, no empty section drawn", async ({
  page,
}) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    factCount: 6,
    domains: [
      {
        tag: "profile",
        heading: "About you",
        facts: [{ id: "p1", text: "Based in Hong Kong.", colour: "gold", source: "told", job: null }],
      },
      // Skills (1 fact) is listed BEFORE the bigger Professional Experience (3 facts) in the
      // payload — proving the client no longer resorts Sorted by domain size.
      { tag: "skill", heading: "Skills", facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told", job: null }] },
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [
          { id: "e1", text: "Managed a team of six engineers.", colour: "gold", source: "told", job: null },
          { id: "e2", text: "Led SAP cutover planning.", colour: "grey", source: "told", job: null },
          { id: "e3", text: "Owned a seven-figure vendor budget.", colour: "grey", source: "told", job: null },
        ],
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  const domainNames = page.locator(".dname");
  await expect(domainNames).toHaveCount(3);
  await expect(domainNames.nth(0)).toHaveText("About you");
  await expect(domainNames.nth(1)).toHaveText("Skills");
  await expect(domainNames.nth(2)).toHaveText("Professional Experience");
  await expect(page.getByText("About you", { exact: true })).toHaveCount(1); // never two headings

  // The merge: the payload's own "About you" facts sit alongside the contact fields in ONE section.
  const about = page.locator(".dom").filter({ hasText: "About you" });
  await expect(about.getByText("Based in Hong Kong.")).toBeVisible();
  await expect(about.getByRole("button", { name: "What's the best phone number for your CV?" })).toBeVisible();

  // No empty section is drawn: only the three domains the payload actually sent.
  await expect(page.locator(".dom")).toHaveCount(3);
});

test("#186 AC2: experience job blocks never pool — a kept fact in job A and an on-CV fact in job B stay apart", async ({
  page,
}) => {
  await stubSession(page);
  const jobA = "IT Project Manager · Veolia";
  const jobB = "Senior Consultant · Capgemini";
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [
          { id: "a1", text: "Coordinated vendor contracts across three markets.", colour: "grey", source: "told", job: jobA },
          { id: "b1", text: "Delivered a SAP rollout across three sites.", colour: "gold", source: "told", job: jobB },
        ],
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  const blocks = page.locator(".jblk");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0).locator(".jhead")).toHaveText(jobA);
  await expect(blocks.nth(1).locator(".jhead")).toHaveText(jobB);

  // Job A's block holds only its own kept fact — job B's on-CV fact never pools into it.
  await expect(blocks.nth(0).getByText("Coordinated vendor contracts across three markets.")).toBeVisible();
  await expect(blocks.nth(0).getByText("Delivered a SAP rollout across three sites.")).toHaveCount(0);
  await expect(blocks.nth(0).locator(".krun")).toHaveText("Left out for space — it swaps in when a job needs it");

  // Job B's block holds only its own on-CV fact — job A's kept fact never pools into it.
  await expect(blocks.nth(1).getByText("Delivered a SAP rollout across three sites.")).toBeVisible();
  await expect(blocks.nth(1).getByText("Coordinated vendor contracts across three markets.")).toHaveCount(0);
  await expect(blocks.nth(1).locator(".krun")).toHaveCount(0); // all-gold block: no caption at all
});

test("#186 AC3: skills/certifications/languages render as chips, sentence facts render as full rows", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      { tag: "skill", heading: "Skills", facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told", job: null }] },
      { tag: "cert", heading: "Certifications", facts: [{ id: "c1", text: "PMP.", colour: "gold", source: "told", job: null }] },
      { tag: "lang", heading: "Languages", facts: [{ id: "l1", text: "English", colour: "gold", source: "told", job: null }] },
      { tag: "edu", heading: "Education", facts: [{ id: "d1", text: "MBA, INSEAD.", colour: "gold", source: "told", job: null }] },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await expect(page.locator(".fact", { hasText: "SQL" })).toBeVisible();
  await expect(page.locator(".fact", { hasText: "PMP" })).toBeVisible();
  await expect(page.locator(".fact", { hasText: "English" })).toBeVisible();
  await expect(page.locator(".frow", { hasText: "MBA, INSEAD." })).toBeVisible();

  // Never crossed: a chip-section fact is never a row, and a sentence fact is never a chip.
  await expect(page.locator(".frow", { hasText: "SQL" })).toHaveCount(0);
  await expect(page.locator(".fact", { hasText: "MBA, INSEAD." })).toHaveCount(0);
});

test("#186 AC4/AC5: the kept caption shows verbatim in list runs and in detail, told/read shows on every fact, and the dead 'waiting for a job that asks' phrasing is gone", async ({
  page,
}) => {
  await stubSession(page);
  const jobA = "IT Project Manager · Veolia";
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [{ id: "a1", text: "Coordinated vendor contracts.", colour: "grey", source: "told", job: jobA }],
      },
      {
        tag: "skill",
        heading: "Skills",
        facts: [
          { id: "s1", text: "SQL.", colour: "gold", source: "told", job: null },
          { id: "s2", text: "Excel.", colour: "grey", source: "read", job: null },
        ],
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  // List-run captions, verbatim (A5) — the experience variant differs from every other section's.
  await expect(page.locator(".jblk .krun")).toHaveText("Left out for space — it swaps in when a job needs it");
  await expect(page.locator(".dom").filter({ hasText: "Skills" }).locator(".krun")).toHaveText("Kept for when a job needs it");

  const dialog = page.locator("dialog.detail");

  // A kept experience fact's detail: the experience caption + the job context line + told/read.
  await page.locator(".frow.grey").click();
  await expect(dialog).toContainText(jobA);
  await expect(dialog).toContainText("Left out for space — it swaps in when a job needs it. You told me this.");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();

  // A kept, non-experience fact's detail: the generic caption + the read line.
  await page.locator(".fact.grey").click();
  await expect(dialog).toContainText("Kept for when a job needs it. Read from your CV.");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();

  // An on-CV fact's detail: no kept caption, and the told line still shows.
  await page.locator(".fact.gold").click();
  await expect(dialog).not.toContainText("Kept for when a job needs it");
  await expect(dialog).toContainText("You told me this.");

  await expect(page.getByText(/waiting for a job that asks/i)).toHaveCount(0);
});

test("#186 AC6: languages are edited in exactly one place, and the door pre-ticks from the eligibility answer — never the CV-mined chip text", async ({
  page,
}) => {
  await stubSession(page);
  // Review round 2 must-fix: the Languages *domain* (chips) is CV-mined claim text, a different
  // provenance than the eligibility store. This fixture makes the two deliberately disagree — the
  // claim mentions English, but the real eligibility answer is Mandarin + Cantonese and does NOT
  // include English — so a test built on the chip text could never have caught the bug.
  let current: ProfileState = {
    ...PROFILE,
    domains: [
      {
        tag: "lang",
        heading: "Languages",
        facts: [{ id: "claim", text: "Fluent in English and Mandarin.", colour: "gold", source: "read", job: null }],
      },
    ],
    languagesQuestion: { ...LANGUAGES_QUESTION, answer: ["Mandarin", "Cantonese"] },
  };
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: current });
  });
  let savedAnswers: string[] | null = null;
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    const body = route.request().postDataJSON() as { itemId: string; answers?: string[] };
    savedAnswers = body.answers ?? null;
    current = { ...current, languagesQuestion: { ...current.languagesQuestion, answer: savedAnswers } };
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/profile");

  // Exactly one editing surface on the whole screen.
  const door = page.getByRole("button", { name: "Change your languages" });
  await expect(door).toHaveCount(1);

  await door.click();
  // Ticks follow the eligibility answer, not the chip text: English is unticked (the answer never
  // included it, even though the claim mentions it), Mandarin/Cantonese are ticked.
  await expect(page.getByRole("checkbox", { name: "English" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "English" })).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Mandarin" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Cantonese" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Vietnamese" })).not.toBeChecked();

  await page.getByRole("checkbox", { name: "Vietnamese" }).check();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Your languages are updated.")).toBeAttached();
  await expect(door).toBeFocused();
  expect(savedAnswers).not.toBeNull();
  expect(savedAnswers).toContain("Mandarin");
  expect(savedAnswers).toContain("Cantonese");
  expect(savedAnswers).toContain("Vietnamese");
  expect(savedAnswers).not.toContain("English"); // the claim text never gets to override the answer
});

test("#186 AC6: saving the languages door unchanged leaves the stored answer exactly as it was — nothing silently erased", async ({
  page,
}) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      { tag: "lang", heading: "Languages", facts: [{ id: "l1", text: "Mandarin", colour: "gold", source: "told", job: null }] },
    ],
    languagesQuestion: { ...LANGUAGES_QUESTION, answer: ["Mandarin", "Cantonese"] },
  };
  await stubProfile(page, state);
  let savedAnswers: string[] | null = null;
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    const body = route.request().postDataJSON() as { itemId: string; answers?: string[] };
    savedAnswers = body.answers ?? null;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/profile");

  await page.getByRole("button", { name: "Change your languages" }).click();
  await page.getByRole("button", { name: "Save" }).click(); // no ticks touched

  await expect(page.getByText("Your languages are updated.")).toBeAttached();
  expect(savedAnswers).not.toBeNull();
  expect(savedAnswers).toHaveLength(2);
  expect(savedAnswers).toContain("Mandarin");
  expect(savedAnswers).toContain("Cantonese");
});

test("#186 AC6: languagesQuestion.answer === null opens every checkbox unticked, with honest 'not answered yet' copy", async ({
  page,
}) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      { tag: "lang", heading: "Languages", facts: [{ id: "claim", text: "English mentioned on CV.", colour: "grey", source: "read", job: null }] },
    ],
    languagesQuestion: { ...LANGUAGES_QUESTION, answer: null },
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Change your languages" }).click();
  await expect(page.getByRole("checkbox", { name: "English" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mandarin" })).not.toBeChecked();
  await expect(page.getByText("You haven't answered this yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
});

test("#186 AC6: cancelling the languages door saves nothing and returns focus to the door", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      {
        tag: "lang",
        heading: "Languages",
        facts: [{ id: "en", text: "English", colour: "gold", source: "told", job: null }],
      },
    ],
    languagesQuestion: { ...LANGUAGES_QUESTION, answer: ["English"] },
  };
  await stubProfile(page, state);
  let answered = false;
  await page.route("**/api/onboarding/discovery/answer", async () => {
    answered = true;
  });
  await page.goto("/profile");

  const door = page.getByRole("button", { name: "Change your languages" });
  await door.click();
  await page.getByRole("checkbox", { name: "Mandarin" }).check();
  await page.getByRole("button", { name: "Keep what I have" }).click();

  await expect(page.getByRole("checkbox", { name: "Mandarin" })).toHaveCount(0); // the door closed
  await expect(door).toBeFocused();
  expect(answered).toBe(false);
});

test("#186: Constellation still sorts by domain size, independent of Sorted's own CV order", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    domains: [
      // Skills (1 fact) is listed FIRST in the payload; Experience (3 facts) is bigger but second.
      { tag: "skill", heading: "Skills", facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told", job: null }] },
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [
          { id: "e1", text: "Managed a team of six engineers.", colour: "gold", source: "told", job: null },
          { id: "e2", text: "Led SAP cutover planning.", colour: "grey", source: "told", job: null },
          { id: "e3", text: "Owned a seven-figure vendor budget.", colour: "grey", source: "told", job: null },
        ],
      },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  // Sorted keeps the payload's own CV order: Skills first.
  await expect(page.locator(".dname").nth(1)).toHaveText("Skills");

  // Constellation keeps its own size-sorted input regardless: the bigger domain (Experience, 3
  // facts) places first, ahead of the payload-first but smaller Skills domain (1 fact) — unpinned
  // since the CV-order split, so this guards against a silent regression to CV order there too.
  await page.getByRole("button", { name: "Constellation" }).click();
  const firstStar = page.locator(".skylist button").first();
  await expect(firstStar).toHaveAttribute(
    "aria-label",
    /Managed a team of six engineers|Led SAP cutover planning|Owned a seven-figure vendor budget/,
  );
});

function job200Facts(): Fact[] {
  const jobs = ["IT Project Manager · Veolia", "Senior Consultant · Capgemini", "Delivery Lead · Atos"];
  const facts: Fact[] = [];
  jobs.forEach((job, ji) => {
    for (let i = 0; i < 67; i++) {
      facts.push({
        id: `j${ji}-${i}`,
        text: `Delivered workstream ${ji}-${i} for ${job}.`,
        colour: i < 30 ? "gold" : "grey",
        source: "told",
        job,
      });
    }
  });
  return facts;
}

test("#186 AC7: a six-fact profile shows only its real sections", async ({ page }) => {
  await stubSession(page);
  const state: ProfileState = {
    ...PROFILE,
    factCount: 6,
    domains: [
      {
        tag: "profile",
        heading: "About you",
        facts: [{ id: "p1", text: "Based in Hanoi.", colour: "gold", source: "told", job: null }],
      },
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [{ id: "e1", text: "Managed a small delivery team.", colour: "gold", source: "told", job: null }],
      },
      { tag: "skill", heading: "Skills", facts: [{ id: "s1", text: "Jira.", colour: "gold", source: "told", job: null }] },
    ],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await expect(page.locator(".dname")).toHaveCount(3);
  await expect(page.locator(".dname")).toHaveText(["About you", "Professional Experience", "Skills"]);
  // Never invented: a section this profile never answered stays entirely absent.
  await expect(page.getByText("Education", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Certifications", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Languages", { exact: true })).toHaveCount(0);
});

test("#186 AC7: a two-hundred-fact profile stays navigable, with sticky job headers anchoring the scroll", async ({
  page,
}) => {
  await stubSession(page);
  // Reduced motion so the `.dom` entrance animation (transform: translateY, up to ~560ms) can't
  // still be mid-flight when we measure the sticky header's position below — an animating ancestor
  // transform is a real source of measurement noise, unrelated to sticky itself.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const facts = job200Facts(); // 201 facts across 3 jobs
  const state: ProfileState = {
    ...PROFILE,
    factCount: facts.length,
    domains: [{ tag: "experience", heading: "Professional Experience", facts }],
  };
  await stubProfile(page, state);
  await page.goto("/profile");

  await expect(page.getByRole("heading", { name: "201 things you've told me" })).toBeVisible();
  const blocks = page.locator(".jblk");
  await expect(blocks).toHaveCount(3);
  const headers = page.locator(".jhead");
  await expect(headers).toHaveCount(3);
  await expect(headers.first()).toHaveCSS("position", "sticky");
  // Every fact is still reachable, no pagination/virtualisation swallowing the tail of the list.
  await expect(page.locator(".frow")).toHaveCount(facts.length);

  // The sticky behaviour itself, not just the declared CSS: scroll well past job 0's header (its
  // block is ~67 rows tall, so 400px lands solidly inside it, nowhere near job 1's header) and
  // check the header is still pinned to the scroll container's own top edge instead of scrolling
  // off with the rest of its block's content.
  const container = page.locator("#profileview.body.sorted");
  const header0 = page.locator("#job-0 .jhead");
  await container.evaluate((el) => {
    el.scrollTop = 400;
  });
  const containerBox = await container.boundingBox();
  const headerBox = await header0.boundingBox();
  expect(containerBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(Math.abs(headerBox!.y - containerBox!.y)).toBeLessThan(6);
});
