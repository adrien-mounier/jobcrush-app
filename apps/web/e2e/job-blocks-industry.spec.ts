import { expect, test, type Page } from "@playwright/test";
import type { JobBlockView, PublishedIndustry } from "../lib/api";

// #281 — the seventh fact ON THE SCREEN. Route-mocked exactly as job-blocks-family.spec.ts does.
//
// Written for the #162 lesson the family spec is also kept for: the payload is not the product.
// Every server-side test in apps/api/test/jobBlockIndustryLabeling.test.ts can pass while the
// industry never reaches a pixel, and only a render assertion catches that. Three claims here:
//
//   1. a placed job SHOWS its industry beside the employer;
//   2. an unplaced one says so honestly, and never borrows the nearest industry;
//   3. she can CORRECT it, and nothing on this screen ever ASKS her which industry she was in.

function decision<T>(id: string, value: T) {
  return {
    id,
    value,
    origin: { kind: "read" as const, source_quote: "from the CV" },
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  };
}

function block(
  id: string,
  title: string,
  employer: string,
  industry: JobBlockView["industry"]["value"],
  kind: JobBlockView["kind"] = "job",
): JobBlockView {
  return {
    id,
    kind,
    countsTowardExperience: kind === "job",
    employer: decision(`${id}:employer`, employer),
    title: decision(`${id}:title`, title),
    start: decision(`${id}:start`, { year: 2019, month: 1, precision: "month" as const }),
    end: decision(`${id}:end`, { state: "ended" as const, date: { year: 2022, month: 3, precision: "month" as const } }),
    kindDecision: decision(`${id}:kind`, kind),
    family: {
      id: `${id}:family`,
      value: null,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    industry: {
      id: `${id}:industry`,
      value: industry,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    confirmed: false,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const INDUSTRIES: PublishedIndustry[] = [
  { industryId: "banking", version: 1, label: "Banking" },
  { industryId: "consulting", version: 1, label: "Consulting" },
  { industryId: "it-services", version: 1, label: "IT services" },
];

const PLACED = block("nordea-analyst", "Settlements Analyst", "Nordea Bank", {
  schemaVersion: "2",
  outcome: "confirmed",
  industries: [{ industryId: "banking", version: 1, confidence: "certain" }],
});
// The ordinary plural case — a consultancy job served into banking. Both are shown; neither wins.
// #282: and each half at its OWN confidence — the employer is certainly a consultancy, the banking
// the work was served into is only likely.
const DUAL = block("acme-consultant", "Consultant", "Acme Advisory", {
  schemaVersion: "2",
  outcome: "confirmed",
  industries: [
    { industryId: "consulting", version: 1, confidence: "certain" },
    { industryId: "banking", version: 1, confidence: "likely" },
  ],
});
// One industry, placed at less than certainty — the machine's own doubt, which her answer replaces.
const SINGLE_LIKELY = block("likely-analyst", "Analyst", "Someplace Bank", {
  schemaVersion: "2",
  outcome: "confirmed",
  industries: [{ industryId: "banking", version: 1, confidence: "likely" }],
});
// The labeler answered, honestly, "nothing fits".
const UNMAPPED = block("zzzz-analyst", "Analyst", "Zzzz Holdings", { schemaVersion: "2", outcome: "unmapped" });
// Never labeled at all (its call failed) — the other shape of "no industry here". From her side it
// must read exactly like the unmapped one: which of the two it was is our own bookkeeping.
const UNLABELED = block("baltic-coord", "Project Coordinator", "Baltic Systems", null);
// A degree belongs to no employer industry, so the card says nothing about one at all.
const DEGREE = block("uni-msc", "MSc Economics", "Aarhus University", null, "education");

async function stub(page: Page, blocks: JobBlockView[], industries: PublishedIndustry[] = INDUSTRIES) {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) =>
    route.fulfill({
      json: {
        blocks,
        summary: { totalBlocks: blocks.length, confirmedBlocks: 0, read: { status: "ok", blocksFound: blocks.length } },
        industries,
      },
    }),
  );
}

test("a placed job shows its industry beside the employer, by its published name", async ({ page }) => {
  await stub(page, [PLACED]);
  await page.goto("/job-blocks/job-1");

  const card = page.locator(".jb-card");
  await expect(card).toContainText("Nordea Bank");
  // The NAME, not the id: a placement carries ids and versions, and "banking" on a screen is a leak.
  await expect(card.locator(".jb-industry")).toContainText("Industry: Banking");
});

test("a job in two industries shows both — neither is dropped to make one answer", async ({ page }) => {
  await stub(page, [DUAL]);
  await page.goto("/job-blocks/job-1");

  await expect(page.locator(".jb-card .jb-industry")).toContainText("Consulting and Banking");
});

test("a job we could not place says so, and never borrows the nearest industry", async ({ page }) => {
  for (const unplaced of [UNMAPPED, UNLABELED]) {
    await stub(page, [unplaced]);
    await page.goto("/job-blocks/job-1");

    const line = page.locator(".jb-card .jb-industry");
    await expect(line).toContainText(/couldn't work out what industry/i);
    await expect(line).toHaveAttribute("data-placed", "false");
    // Not one of the published names anywhere on the card — an honest gap, not a nearest guess.
    await expect(page.locator(".jb-card")).not.toContainText(/Banking|Consulting|IT services/);
  }
});

test("a degree is never given an industry, not even an unplaced one", async ({ page }) => {
  await stub(page, [DEGREE]);
  await page.goto("/job-blocks/job-1");

  await expect(page.locator(".jb-card")).toContainText("Aarhus University");
  await expect(page.locator(".jb-card .jb-industry")).toHaveCount(0);
});

test("nothing on this screen ASKS her which industry she was in", async ({ page }) => {
  await stub(page, [PLACED, UNMAPPED, UNLABELED]);
  await page.goto("/job-blocks/job-1");

  // The card states; it never questions. No industry question anywhere in the deck, and no
  // industry control until she opens the correction panel herself.
  await expect(page.getByText(/which industry/i)).toHaveCount(0);
  await expect(page.getByText(/what industry was (this|your)/i)).toHaveCount(0);
  await expect(page.locator("#jb-industry")).toHaveCount(0);
});

test("she can correct the industry, and only a published one is ever sent", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "We'll show this job as IT services from now on." } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [UNMAPPED]);
  await page.goto("/job-blocks/job-1");

  // Tapping the card is how a correction is opened — the horizontal axis is confirm-only.
  await page.locator(".jb-card").click();
  const picker = page.locator("#jb-industry");
  await expect(picker).toBeVisible();
  // It offers exactly the published vocabulary plus the readout of "we couldn't work this out".
  await expect(picker.locator("option")).toHaveCount(INDUSTRIES.length + 1);

  await picker.selectOption("it-services");
  // The card behind the panel already reads her answer back before anything is saved.
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect
    .poll(() => sent)
    .toEqual([{ key: "industry", value: { industryId: "it-services", version: 1 } }]);
});

// Found by the #281 QA gate: the panel promises "picking one here replaces both", and narrowing a
// two-industry job to its FIRST-listed industry used to send nothing at all — the picker already
// showed that industry as selected, so the change was invisible to a head-only comparison.
test("narrowing a two-industry job to its first-listed industry still saves", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [DUAL]);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  const picker = page.locator("#jb-industry");
  // The panel says what picking one will do, so it has to actually do it.
  await expect(page.locator(".jb-back")).toContainText(/picking one here replaces both/i);
  await expect(picker).toHaveValue("consulting");

  await picker.selectOption("consulting");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect
    .poll(() => sent)
    .toEqual([{ key: "industry", value: { industryId: "consulting", version: 1 } }]);
});

// Found by the #282 QA gate, by pressing Save rather than by reading the types. Contract v2 put a
// CONFIDENCE on every industry reference; the screen was passing those references straight into the
// correction body, and the server refuses a browser-asserted confidence outright (it is the
// server's to stamp — a caller must not be able to ask for its own correction to be attenuated).
// Every industry correction failed with a 400, forever, on the only lever a person has over this
// axis. The two assertions below are what makes that impossible to reintroduce: the exact body,
// and that re-picking what the card already says is still not a change.
test("the correction body carries id and version only — never the confidence v2 added", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  // PLACED is banking at `certain`; she moves it to consulting.
  await stub(page, [PLACED]);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  await page.locator("#jb-industry").selectOption("consulting");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect
    .poll(() => sent)
    .toEqual([{ key: "industry", value: { industryId: "consulting", version: 1 } }]);
  // Belt and braces: no key beyond the two, whatever the placement carried.
  expect(Object.keys((sent[0] as { value: object }).value).sort()).toEqual(["industryId", "version"]);
});

test("re-picking the industry the card already shows is not a change, whatever the machine's confidence was", async ({ page }) => {
  // The other half of the v2 hazard. Her pick is stamped `certain`; DUAL's first industry was placed
  // `certain` and its second `likely`. If confidence counted toward "did anything change?", picking
  // what the card already says would send a correction — v2 must not quietly redefine a change.
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [SINGLE_LIKELY]);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  await expect(page.locator("#jb-industry")).toHaveValue("banking");
  await page.locator("#jb-industry").selectOption("banking");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect(page.locator(".jb-back")).toHaveCount(0); // the save went through
  expect(sent).toEqual([]);
});

test("saving with the industry untouched sends no industry correction", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [DUAL]);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect(page.locator(".jb-back")).toHaveCount(0); // the save went through
  expect(sent).toEqual([]);
});

test("no industry picker at all when no vocabulary reached the screen", async ({ page }) => {
  // An older API, or a build with no vocabulary wired: the screen degrades to saying nothing about
  // industries rather than offering a choice the correction door would then refuse.
  await stub(page, [PLACED], []);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  await expect(page.locator("#jb-industry")).toHaveCount(0);
});
