import { expect, test, type Page } from "@playwright/test";
import type { JobBlockView } from "../lib/api";

// #231 — the review screen has NO family question, anywhere. Route-mocked exactly as
// factbadge.spec.ts / tailor.spec.ts do.
//
// This file used to assert the opposite: #221 ended the deck with a batched "what kind of work were
// these?" panel for every job the machine could not place. ADR-0014 amendment 1 deleted it — a job
// can be in several families and nobody is asked. The spec is kept, inverted, rather than deleted,
// for the same reason it was written in the first place (the #162 lesson): the payload is not the
// product. Every server-side test can pass while a question the product promised to stop asking is
// still on the screen, and only a render assertion catches that.
//
// Every block is served already confirmed, so the deck lands straight on its end state — where the
// questions used to live.

function decision<T>(id: string, value: T) {
  return {
    id,
    value,
    origin: { kind: "read" as const, source_quote: "from the CV" },
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  };
}

function block(id: string, title: string, employer: string, family: JobBlockView["family"]["value"]): JobBlockView {
  return {
    id,
    kind: "job",
    countsTowardExperience: true,
    employer: decision(`${id}:employer`, employer),
    title: decision(`${id}:title`, title),
    start: decision(`${id}:start`, { year: 2019, month: 1, precision: "month" as const }),
    end: decision(`${id}:end`, { state: "ended" as const, date: { year: 2022, month: 3, precision: "month" as const } }),
    kindDecision: decision(`${id}:kind`, "job" as const),
    family: {
      id: `${id}:family`,
      value: family,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    confirmed: true,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const PLACED = block("nordic-pm", "IT Project Manager", "Nordic Retail", {
  schemaVersion: "2",
  outcome: "confirmed",
  families: [{ familyId: "it-project-delivery", version: 2 }],
  confidence: "certain",
});
// Two kinds of work at once — the case that used to be a question, now simply an answer.
const DUAL = block("acme-lead", "Product Owner / Delivery Lead", "Acme", {
  schemaVersion: "2",
  outcome: "confirmed",
  families: [
    { familyId: "it-project-delivery", version: 2 },
    { familyId: "product-management", version: 2 },
  ],
  confidence: "likely",
});
const UNPLACED = block("cafe-baker", "Pastry Chef", "Café Nord", { schemaVersion: "2", outcome: "unmapped" });
// Never labeled at all (the labeler's call failed) — the other shape of "no family here".
const UNLABELED = block("baltic-coord", "Project Coordinator", "Baltic", null);

async function stub(page: Page, blocks: JobBlockView[]) {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) =>
    route.fulfill({
      json: {
        blocks,
        summary: { totalBlocks: blocks.length, confirmedBlocks: blocks.length, read: { status: "ok", blocksFound: blocks.length } },
      },
    }),
  );
}

test("no job is asked what kind of work it was — not the unplaced one, not the unlabeled one", async ({ page }) => {
  const correctCalls: string[] = [];
  await page.route("**/api/job-blocks/*/correct", (route) => {
    correctCalls.push(route.request().url());
    return route.fulfill({ json: { ok: true, held: [], downstream: "" } });
  });
  await stub(page, [PLACED, DUAL, UNPLACED, UNLABELED]);
  await page.goto("/job-blocks/job-1");

  await expect(page.getByText(/That's your history straight/i)).toBeVisible();

  // The panel and its copy are gone outright — not merely empty.
  await expect(page.locator(".jb-familyask")).toHaveCount(0);
  await expect(page.getByText(/what kind of work/i)).toHaveCount(0);
  await expect(page.getByText(/couldn't place this one/i)).toHaveCount(0);
  await expect(page.getByText(/never guess one for you/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /IT Project Manager|IT project delivery/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Product management/i })).toHaveCount(0);

  // And nothing on this screen sends a family correction of its own accord.
  expect(correctCalls).toEqual([]);
});

test("the card itself still says nothing about families", async ({ page }) => {
  // Unconfirmed, so the deck shows the card rather than its end state — a dual-family job, which is
  // the placement most likely to leak into copy.
  await stub(page, [{ ...DUAL, confirmed: false }]);
  await page.goto("/job-blocks/job-1");

  const card = page.locator(".jb-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/put this down as/i); // the kind, which the card has always stated
  await expect(card).not.toContainText(/family/i);
  await expect(card).not.toContainText(/IT Project Manager|IT project delivery/i);
  await expect(card).not.toContainText(/kind of work/i);
});
