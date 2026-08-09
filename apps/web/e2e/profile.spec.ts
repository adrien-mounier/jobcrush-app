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

const PROFILE: ProfileState = {
  factCount: 4,
  search: { role: "IT project manager in Paris", family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: "experience",
      heading: "Professional Experience",
      facts: [
        { id: "e1", text: "Managed a team of six engineers.", colour: "gold", source: "told" },
        {
          id: "e2",
          text: "Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.",
          colour: "grey",
          source: "read",
        },
        { id: "e3", text: "Led SAP cutover planning.", colour: "grey", source: "told" },
      ],
    },
    {
      tag: "skill",
      heading: "Skills",
      facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told" }],
    },
  ],
  contact: { phone: null, email: null }, // #190's honest-absence default; populated fixtures below
};

async function stubProfile(page: Page, state: ProfileState = PROFILE) {
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: state });
  });
}

test("the screen loads, opening on the fullest domain with its strongest fact leading", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);

  await page.goto("/profile");

  const heading = page.getByRole("heading", { name: "4 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  // About you (#190) always leads; the fullest domain (Professional Experience, 3 facts) is listed
  // before Skills (1 fact).
  const domainNames = page.locator(".dname");
  await expect(domainNames.nth(0)).toHaveText("About you");
  await expect(domainNames.nth(1)).toHaveText("Professional Experience");
  await expect(domainNames.nth(2)).toHaveText("Skills");

  // Its lead is the longest fact, without preferring gold over grey.
  const firstLead = page.locator(".dlead").first();
  await expect(firstLead).toHaveText("Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.");
  await expect(firstLead).toHaveClass(/grey/);
  await expect(firstLead).toHaveCSS("color", "rgb(151, 170, 188)");
  await expect(page.locator(".dlead").nth(1)).toHaveClass(/gold/);
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
  await stubProfile(page);
  await page.goto("/profile");

  // A gold fact and a grey fact both render as fact chips in Sorted.
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

test("phone: field and rail stack in one column with nothing missing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const stageDirection = await page.locator(".stage").evaluate((el) => getComputedStyle(el).flexDirection);
  expect(stageDirection).toBe("column");

  const field = page.locator(".field");
  const rail = page.locator(".rail");
  await expect(field).toBeAttached();
  await expect(rail).toBeAttached();

  const fieldBox = await field.boundingBox();
  const railBox = await rail.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  // Stacked: the rail starts at/after the field's bottom edge.
  expect(railBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height - 5);

  // Nothing missing — the door is still reachable by scrolling.
  const door = page.getByRole("button", { name: "Not the job you meant?" });
  await door.scrollIntoViewIfNeeded();
  await expect(door).toBeVisible();
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
        })).concat(
          Array.from<unknown, Fact>({ length: 6 }, (_, i) => ({
            id: `s${i}`,
            text: `Saved fact ${i}.`,
            colour: "grey",
            source: "told",
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
