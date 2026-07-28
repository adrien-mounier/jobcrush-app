// Golden tests: the zod ports and the copied .mjs oracle validators must agree on every fixture.
// The oracle is the spec — if these ever disagree, the zod port is wrong, not the oracle.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaimGraph, Inbox, JobCardV1 } from "../src/index.js";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateGraph } from "../oracle/validate_graph.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateInbox } from "../oracle/validate_proposal.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateJobCardV1 } from "../oracle/validate_job_card_v1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "..", "fixtures", name), "utf8"));

describe("Contract 1 — claim graph", () => {
  it("valid fixture passes both oracle and zod", () => {
    const g = fixture("graph.valid.json");
    expect(validateGraph(g).ok).toBe(true);
    expect(ClaimGraph.safeParse(g).success).toBe(true);
  });

  it("invalid fixture fails both oracle and zod", () => {
    const g = fixture("graph.invalid.json");
    const oracle = validateGraph(g);
    const port = ClaimGraph.safeParse(g);
    expect(oracle.ok).toBe(false);
    expect(port.success).toBe(false);
    // the safety-critical invariant specifically: Negative => renderable=false
    expect(oracle.errors.join("\n")).toMatch(/renderable=false/);
    expect(JSON.stringify(port.error?.issues)).toMatch(/renderable=false/);
  });

  it("per-invariant mutations keep oracle and zod in agreement", () => {
    const base = fixture("graph.valid.json");
    const mutations: Array<(g: any) => void> = [
      (g) => (g.nodes[0].id = "Not A Slug"),
      (g) => (g.nodes[0].tags = []),
      (g) => (g.nodes[0].source_file = null), // Verified needs provenance
      (g) => (g.nodes[2].narrative_ref = null), // enrichment needs narrative
      (g) => (g.nodes[2].risk = null), // UbP needs risk
      (g) => (g.nodes[1].renderable = true), // Negative must not render
      (g) => (g.nodes[0].confirmed_date = "17-07-2026"), // ISO date
      (g) => g.nodes.push({ ...g.nodes[0] }), // duplicate id
      (g) => (g.graphVersion = 0),
    ];
    for (const mutate of mutations) {
      const g = JSON.parse(JSON.stringify(base));
      mutate(g);
      const oracle = validateGraph(g).ok;
      const port = ClaimGraph.safeParse(g).success;
      expect(port, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("Contract 3 — enrichment inbox", () => {
  it("valid fixture passes both oracle and zod", () => {
    const inbox = fixture("inbox.valid.json");
    expect(validateInbox(inbox).ok).toBe(true);
    expect(Inbox.safeParse(inbox).success).toBe(true);
  });

  it("invalid fixture fails both oracle and zod", () => {
    const inbox = fixture("inbox.invalid.json");
    expect(validateInbox(inbox).ok).toBe(false);
    expect(Inbox.safeParse(inbox).success).toBe(false);
  });

  it("per-invariant mutations keep oracle and zod in agreement", () => {
    const base = fixture("inbox.valid.json");
    const mutations: Array<(i: any) => void> = [
      (i) => (i.proposals[0].interviewNarrative = ""), // every stretch carries a narrative
      (i) => (i.proposals[0].state = "parked"), // bad enum
      (i) => (i.proposals[1].decidedAt = null), // approved needs decidedAt
      (i) => (i.proposals[0].narrativeAnchor = "Bad Anchor!"),
      (i) => i.proposals.push({ ...i.proposals[0] }), // duplicate id
    ];
    for (const mutate of mutations) {
      const inbox = JSON.parse(JSON.stringify(base));
      mutate(inbox);
      const oracle = validateInbox(inbox).ok;
      const port = Inbox.safeParse(inbox).success;
      expect(port, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("JobCard v1", () => {
  it("valid fixture passes both oracle and zod", () => {
    const card = fixture("job-card-v1.valid.json");
    expect(validateJobCardV1(card).ok).toBe(true);
    expect(JobCardV1.safeParse(card).success).toBe(true);
  });

  it("rejects invalid counts, ranges, and versions in both", () => {
    const mutations: Array<(card: any) => void> = [
      (card) => (card.schemaVersion = "2"),
      (card) => (card.matchPct = 101),
      (card) => (card.breakdown.essential.met = -1),
      (card) => (card.breakdown.desirable.total = 1.5),
      (card) => (card.breakdown.essential.met = card.breakdown.essential.total + 1),
      (card) => delete card.title,
      (card) => (card.salary = 42),
      (card) => delete card.bubble.open,
      (card) => (card.fit[0].text = null),
      (card) => (card.dontYet[0].band = "critical"),
      (card) => (card.askedClosed = {}),
      (card) => delete card.adExcerpt,
    ];
    for (const mutate of mutations) {
      const card = fixture("job-card-v1.valid.json");
      mutate(card);
      expect(JobCardV1.safeParse(card).success).toBe(validateJobCardV1(card).ok);
      expect(validateJobCardV1(card).ok).toBe(false);
    }
  });
});
