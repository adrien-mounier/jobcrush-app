import { expect, test, type Page } from "@playwright/test";
import type { JobBlockView, PublishedFamily } from "../lib/api";

// #414 (ADR-0020 clause 5) — the sixth fact ON THE SCREEN, correctable to "both". Route-mocked
// exactly as job-blocks-industry.spec.ts does.
//
// History: #221 ended this deck with a batched "what kind of work were these?" question; #231
// deleted it (nobody is asked) and this spec pinned that the card said nothing about families at
// all. #414 replaces that: the card STATES the families, never asks, and the correction panel
// offers the published list as a multi-choice so the person can say a job was both kinds of work.
// Kept as a render spec for the #162 lesson: every server-side test can pass while the row never
// reaches a pixel, and only a render assertion catches that.

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
  family: JobBlockView["family"]["value"],
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
      value: family,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    // The seventh fact exists on every block; this spec is about the sixth, so it stays unplaced.
    industry: {
      id: `${id}:industry`,
      value: null,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    confirmed: false,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const FAMILIES: PublishedFamily[] = [
  { familyId: "it-project-delivery", version: 2, label: "IT Project Manager" },
  { familyId: "business-analysis", version: 2, label: "Business analysis" },
  { familyId: "product-management", version: 1, label: "Product Manager" },
];

const PLACED = block("nordic-pm", "IT Project Manager", "Nordic Retail", {
  schemaVersion: "2",
  outcome: "confirmed",
  families: [{ familyId: "it-project-delivery", version: 2 }],
  confidence: "certain",
});
// Two kinds of work at once — stated as both, never asked.
const DUAL = block("acme-lead", "Product Owner / Delivery Lead", "Acme", {
  schemaVersion: "2",
  outcome: "confirmed",
  families: [
    { familyId: "it-project-delivery", version: 2 },
    { familyId: "product-management", version: 1 },
  ],
  confidence: "likely",
});
// The owner's own case: titled Product Owner, placed by the machine in product management only.
const OKOONE = block("okoone-po", "Product Owner", "Okoone", {
  schemaVersion: "2",
  outcome: "confirmed",
  families: [{ familyId: "product-management", version: 1 }],
  confidence: "certain",
});
const UNPLACED = block("cafe-baker", "Pastry Chef", "Café Nord", { schemaVersion: "2", outcome: "unmapped" });
// Never labeled at all (the labeler's call failed) — the other shape of "no family here".
const UNLABELED = block("baltic-coord", "Project Coordinator", "Baltic", null);
const DEGREE = block("uni-msc", "MSc Economics", "Aarhus University", null, "education");

async function stub(page: Page, blocks: JobBlockView[], families: PublishedFamily[] = FAMILIES) {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) =>
    route.fulfill({
      json: {
        blocks,
        summary: { totalBlocks: blocks.length, confirmedBlocks: 0, read: { status: "ok", blocksFound: blocks.length } },
        families,
      },
    }),
  );
}

test("a placed job shows its kind of work in plain words, by the published name", async ({ page }) => {
  await stub(page, [PLACED]);
  await page.goto("/job-blocks/job-1");

  const card = page.locator(".jb-card");
  await expect(card).toContainText("Nordic Retail");
  // The NAME, not the id: "it-project-delivery" on a screen is a leak.
  await expect(card.locator(".jb-family")).toContainText("Kind of work: IT Project Manager");
  await expect(card).not.toContainText("it-project-delivery");
});

test("a job that was two kinds of work shows both", async ({ page }) => {
  await stub(page, [DUAL]);
  await page.goto("/job-blocks/job-1");

  await expect(page.locator(".jb-card .jb-family")).toContainText("IT Project Manager and Product Manager");
});

test("a job we could not place says so, and never borrows the nearest family", async ({ page }) => {
  for (const unplaced of [UNPLACED, UNLABELED]) {
    await stub(page, [unplaced]);
    await page.goto("/job-blocks/job-1");

    const line = page.locator(".jb-card .jb-family");
    await expect(line).toContainText(/couldn't work out the kind of work/i);
    await expect(line).toHaveAttribute("data-placed", "false");
    await expect(page.locator(".jb-card")).not.toContainText(/IT Project Manager|Business analysis|Product Manager/);
  }
});

test("a degree is never given a kind of work", async ({ page }) => {
  await stub(page, [DEGREE]);
  await page.goto("/job-blocks/job-1");

  await expect(page.locator(".jb-card")).toContainText("Aarhus University");
  await expect(page.locator(".jb-card .jb-family")).toHaveCount(0);
});

test("nothing on this screen ASKS what kind of work a job was", async ({ page }) => {
  const correctCalls: string[] = [];
  await page.route("**/api/job-blocks/*/correct", (route) => {
    correctCalls.push(route.request().url());
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await stub(page, [PLACED, UNPLACED, UNLABELED].map((b) => ({ ...b, confirmed: true })));
  await page.goto("/job-blocks/job-1");

  await expect(page.getByText(/That's your history straight/i)).toBeVisible();
  // #231's deletion holds: no batched panel, no question copy, no family control until she opens
  // the correction panel herself — and nothing sends a family correction of its own accord.
  await expect(page.locator(".jb-familyask")).toHaveCount(0);
  await expect(page.getByText(/what kind of work were/i)).toHaveCount(0);
  await expect(page.locator("#jb-family")).toHaveCount(0);
  expect(correctCalls).toEqual([]);
});

test("she can say a job was both kinds of work, and both are saved", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({
      json: { ok: true, held: [], downstream: "We'll count this job as Product Manager and IT Project Manager from now on." },
    });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [OKOONE]);
  await page.goto("/job-blocks/job-1");

  // Tapping the card is how a correction is opened — the horizontal axis is confirm-only.
  await page.locator(".jb-card").click();
  const group = page.locator("#jb-family");
  await expect(group).toBeVisible();
  // It offers exactly the published families, with the machine's own answer already chosen.
  const choices = group.getByRole("button");
  await expect(choices).toHaveCount(FAMILIES.length);
  await expect(group.getByRole("button", { name: /Product Manager/ })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: /IT Project Manager/ })).toHaveAttribute("aria-pressed", "false");

  await group.getByRole("button", { name: /IT Project Manager/ }).click();
  await expect(group.getByRole("button", { name: /IT Project Manager/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  await expect.poll(() => sent).toEqual([
    {
      key: "family",
      value: [
        { familyId: "product-management", version: 1 },
        { familyId: "it-project-delivery", version: 2 },
      ],
    },
  ]);
});

test("at least one kind of work stays chosen — the last one cannot be switched off", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await page.route("**/api/job-blocks/*/confirm", (route) => route.fulfill({ json: { ok: true } }));
  await stub(page, [PLACED]);
  await page.goto("/job-blocks/job-1");

  await page.locator(".jb-card").click();
  const only = page.locator("#jb-family").getByRole("button", { name: /IT Project Manager/ });
  await expect(only).toHaveAttribute("aria-pressed", "true");
  await only.click();
  await expect(only).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Save and continue/i }).click();

  // Nothing changed, so nothing is sent for the family.
  await expect(page.getByText(/Saved your correction/i).first()).toBeVisible();
  expect(sent.filter((c) => (c as { key: string }).key === "family")).toEqual([]);
});
