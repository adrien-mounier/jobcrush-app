// #222 (labeler slice 3, ADR-0014 amendment 1) — years per family, read at the advert's own scope.
//
// Two layers, per the spec's own testing decisions:
//   - pure computation table-driven (computeFamilyYears / familyPlacementConfidence / the single
//     writer's per-family facts);
//   - scope reading asserted at the API surface: the deck route with a fake judge, real stores, a
//     confirmed session family, and labeled job records — family bars vs total bars vs the known
//     zero vs the unaccounted-years fallback, plus the confidence attenuation on a REAL card score
//     (#231 AC6's other half; attenuateForConfidence's production caller is buildJobCard).
import { describe, expect, it } from "vitest";
import type { FamilyPlacement, MinedJobBlock, PlacementConfidence } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import type { JudgeFn } from "../src/judge.js";
import { makeJobBlockLabeler } from "../src/familyLabeler.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { InMemorySessionStore } from "../src/sessions.js";
import {
  computeFamilyYears,
  familyPlacementConfidence,
  hasUnplacedWork,
  refreshWorkedYears,
} from "../src/yearsWorked.js";

const FAMILY = "it-project-delivery"; // the one published family — the session's confirmed floor
const OTHER = "field-marketing"; // a family the advert is NOT in (labels need no publication to be stored)
// The motivating advert (spec #219): "8+ years of IT experience including 5+ years as a Project
// Manager" — now two scoped bars in the fixture (total >= 8, family >= 5).
const COMPOUND_AD = "2026-07-05_endava-vietnam_senior-project-manager";

const decision = (value: string) => ({
  value,
  source_quote: value,
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
});

function block(id: string, startYear: number, endYear: number): MinedJobBlock {
  return {
    id,
    employer: decision(`Employer ${id}`),
    title: decision("Regional PM"),
    start: {
      value: { year: startYear, month: 1, precision: "month" },
      source_quote: `Jan ${startYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    end: {
      value: { state: "ended", date: { year: endYear, month: 12, precision: "month" } },
      source_quote: `Dec ${endYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}

const placed = (familyIds: string[], confidence: PlacementConfidence = "certain"): FamilyPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  families: familyIds.map((familyId) => ({ familyId, version: 1 })),
  confidence,
});

// A judge that finds every requirement fully evidenced, instantly — so any movement in a card's
// matchPct below comes from the years shortfall / attenuation under test, nothing else.
const fullFitJudge: JudgeFn = async (adReq) => ({
  verdicts: adReq.requirements.map((r) => ({
    requirementId: r.id,
    fit: 1,
    supportingFactId: null,
    reason: "test",
  })),
  version: "test",
  cost: { model: "fake-judge", inputTokens: 1, outputTokens: 1, judgedAt: new Date().toISOString() },
});

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

/** A session with labeled job records, per-family facts synced, and the family known — the state
 *  a visitor is in when the deck opens. `family` picks HOW the advert family is resolvable:
 *  "floor" = the production-discovery checkpoint pinned it; "placement" = only the target-role
 *  placement seam answers (the SHIPPED journey — QA finding 1); "none" = neither. */
async function seededDeck(
  blocks: MinedJobBlock[],
  labels: Record<string, FamilyPlacement>,
  family: "floor" | "placement" | "none" = "floor",
) {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  const sessions = new InMemorySessionStore();
  await jobBlocks.init();
  const server = buildServer({
    jobBlocks,
    eligibility,
    sessions,
    judge: fullFitJudge,
    judgeMaxCards: 99, // every fixture card judged — the bound is not what this test is about
    ...(family === "placement" ? { placeFamily: async () => placed([FAMILY]) } : {}),
  });
  const cookie = await anonSession(server.app);
  const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
  const sessionId = me.json().id as string;
  await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks }, "{}");
  for (const [blockId, placement] of Object.entries(labels)) {
    await jobBlocks.label(sessionId, blockId, placement);
  }
  // Stands in for the labeler step's own refresh (makeJobBlockLabeler) — labels were written
  // directly here, so the facts are re-derived the same way.
  await refreshWorkedYears(jobBlocks, eligibility, sessionId);
  if (family === "floor") {
    await sessions.reconcileDiscoveryState(sessionId, { familyId: FAMILY, version: 1 }, [], false);
  }
  return { app: server.app, cookie, sessionId, jobBlocks, eligibility };
}

async function compoundCard(harness: Awaited<ReturnType<typeof seededDeck>>) {
  const res = await harness.app.inject({
    method: "GET",
    url: "/onboarding/cards",
    headers: { cookie: harness.cookie },
  });
  const cards = (res.json() as { cards: Array<{ adId: string; matchPct: number | null; scored: string }> }).cards;
  return cards.find((c) => c.adId === COMPOUND_AD);
}

// --- pure computation, table-driven ------------------------------------------------------------

// The view the product itself computes: ingest + label through the real store, read back.
async function viewOf(blocks: MinedJobBlock[], labels: Record<string, FamilyPlacement>) {
  const store = new InMemoryJobBlockStore();
  await store.init();
  await store.ingest("s", { schemaVersion: "1", blocks }, "{}");
  for (const [blockId, placement] of Object.entries(labels)) await store.label("s", blockId, placement);
  return store.list("s");
}

describe("#222 computeFamilyYears", () => {
  const now = new Date(Date.UTC(2026, 0, 1));

  it("a job carrying two families contributes its FULL length to both — never split", async () => {
    const view = await viewOf([block("b1", 2018, 2023)], { b1: placed([FAMILY, OTHER]) });
    const perFamily = computeFamilyYears(view, now);
    expect(perFamily.get(FAMILY)).toBe(6);
    expect(perFamily.get(OTHER)).toBe(6);
  });

  it("the family numbers do not sum to the career total, and that is the design", async () => {
    // 6 years of dual-family work: 6 in each family, 6 (not 12) in the career.
    const view = await viewOf([block("b1", 2018, 2023)], { b1: placed([FAMILY, OTHER]) });
    const summed = [...computeFamilyYears(view, now).values()].reduce((a, b) => a + b, 0);
    expect(summed).toBe(12); // which is why no surface may print a sum of families as one figure
  });

  it("overlapping same-family jobs merge — calendar months counted once per family", async () => {
    const view = await viewOf(
      [block("b1", 2018, 2021), block("b2", 2020, 2023)],
      { b1: placed([FAMILY]), b2: placed([FAMILY]) },
    );
    expect(computeFamilyYears(view, now).get(FAMILY)).toBe(6);
  });

  it("an unmapped job contributes to NO family, and counts as unaccounted work", async () => {
    const view = await viewOf([block("b1", 2018, 2023), block("b2", 2010, 2015)], {
      b1: placed([FAMILY]),
      b2: { schemaVersion: "2", outcome: "unmapped" },
    });
    const perFamily = computeFamilyYears(view, now);
    expect(perFamily.get(FAMILY)).toBe(6);
    expect(perFamily.size).toBe(1);
    expect(hasUnplacedWork(view)).toBe(true);
  });

  it("every job placed → nothing unaccounted", async () => {
    const view = await viewOf([block("b1", 2018, 2023)], { b1: placed([FAMILY]) });
    expect(hasUnplacedWork(view)).toBe(false);
  });
});

describe("#222 familyPlacementConfidence", () => {
  it("is the WEAKEST contributing placement's level, and null with no contributor", async () => {
    const view = await viewOf(
      [block("b1", 2018, 2023), block("b2", 2010, 2015)],
      { b1: placed([FAMILY], "certain"), b2: placed([FAMILY], "possible") },
    );
    expect(familyPlacementConfidence(view, FAMILY)).toBe("possible");
    expect(familyPlacementConfidence(view, OTHER)).toBeNull();
  });
});


// --- the single writer: one fact per family plus the total -------------------------------------

describe("#222 the single writer stores one fact per family, and keeps them honest", () => {
  it("writes the career total at ANY_FAMILY and one fact per family with a dated job", async () => {
    const { sessionId, eligibility } = await seededDeck(
      [block("b1", 2018, 2023), block("b2", 2010, 2015)],
      { b1: placed([FAMILY]), b2: placed([OTHER]) },
    );
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(12);
    expect(await eligibility.numeric(sessionId, "years-experience", FAMILY)).toBe(6);
    expect(await eligibility.numeric(sessionId, "years-experience", OTHER)).toBe(6);
  });

  it("an unmapped job counts toward the total and toward no family number", async () => {
    const { sessionId, eligibility } = await seededDeck(
      [block("b1", 2018, 2023), block("b2", 2010, 2015)],
      { b1: placed([FAMILY]) }, // b2 never labeled — unaccounted
    );
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(12);
    expect(await eligibility.numeric(sessionId, "years-experience", FAMILY)).toBe(6);
    expect(await eligibility.get(sessionId, "years-experience", OTHER)).toBeNull();
  });

  it("a label correction re-derives at the door: the old family's fact is removed, the new one written", async () => {
    const { app, cookie, sessionId, eligibility } = await seededDeck(
      [block("b1", 2018, 2023)],
      { b1: placed([OTHER]) },
    );
    expect(await eligibility.numeric(sessionId, "years-experience", OTHER)).toBe(6);

    const res = await app.inject({
      method: "POST",
      url: "/job-blocks/b1/correct",
      headers: { cookie },
      payload: { key: "family", value: { familyId: FAMILY, version: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(await eligibility.numeric(sessionId, "years-experience", FAMILY)).toBe(6);
    expect(await eligibility.get(sessionId, "years-experience", OTHER)).toBeNull(); // stale copy gone
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(6); // total once
  });

  it("confidence NEVER changes the years fact, at any scope (#231 AC6 regression)", async () => {
    const factsAt = async (confidence: PlacementConfidence) => {
      const { sessionId, eligibility } = await seededDeck(
        [block("b1", 2016, 2023)],
        { b1: placed([FAMILY], confidence) },
      );
      return {
        family: await eligibility.numeric(sessionId, "years-experience", FAMILY),
        total: await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY),
      };
    };
    const certain = await factsAt("certain");
    const likely = await factsAt("likely");
    const possible = await factsAt("possible");
    expect(certain).toEqual({ family: 8, total: 8 });
    expect(likely).toEqual(certain);
    expect(possible).toEqual(certain);
  });
});

// --- the labeler is a door too -----------------------------------------------------------------

describe("#222 the labeling step re-derives the per-family facts it just made true", () => {
  it("after makeJobBlockLabeler runs, the family facts exist without any other door being touched", async () => {
    const store = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    await store.init();
    await store.ingest("s", { schemaVersion: "1", blocks: [block("b1", 2018, 2023)] }, "{}");
    const llm = {
      complete: async () =>
        JSON.stringify({ outcome: "confirmed", familyIds: [FAMILY], confidence: "certain" }),
    };
    const families = [
      { familyId: FAMILY, version: 1, label: "IT project delivery", scope: "delivery", exampleTitles: [], coreWork: [] },
    ];
    await makeJobBlockLabeler(llm, families, store, eligibility)("s");
    expect(await eligibility.numeric("s", "years-experience", FAMILY)).toBe(6);
    expect(await eligibility.numeric("s", "years-experience", ANY_FAMILY)).toBe(6);
  });
});

// --- the API surface: the advert's own scope ---------------------------------------------------

describe("#222 an advert's years bars are tested at their own scope (API surface)", () => {
  it("the compound advert sees both numbers: the family bar reads family years, the total bar the total", async () => {
    // Same career total (10y), different family split. If the family bar (>= 5) read the total,
    // these two would score identically; if the total bar (>= 8) read the family number, the
    // second visitor's total bar would fail. Only per-scope reading scores A full and B short.
    const fullAtBoth = await seededDeck(
      [block("b1", 2016, 2023), block("b2", 2012, 2013)], // 8y family + 2y other = 10y total
      { b1: placed([FAMILY]), b2: placed([OTHER]) },
    );
    const shortInFamily = await seededDeck(
      [block("b1", 2020, 2023), block("b2", 2012, 2017)], // 4y family + 6y other = 10y total
      { b1: placed([FAMILY]), b2: placed([OTHER]) },
    );
    const cardA = await compoundCard(fullAtBoth);
    const cardB = await compoundCard(shortInFamily);
    expect(cardA?.scored).toBe("judged");
    expect(cardA?.matchPct).toBe(100); // family 8 >= 5, total 10 >= 8, judge found everything
    expect(cardB?.scored).toBe("judged");
    expect(cardB!.matchPct!).toBeLessThan(cardA!.matchPct!); // 4 < 5 in the advert's own family
  });

  it("KNOWN ZERO: every job placed, none in the advert's family → the family bar tests 0, and the card stays", async () => {
    const knownZero = await seededDeck(
      [block("b1", 2014, 2018), block("b2", 2019, 2023)], // 10y, all of it in another family
      { b1: placed([OTHER]), b2: placed([OTHER]) },
    );
    const card = await compoundCard(knownZero);
    expect(card).toBeDefined(); // never withdrawn — it sinks, it does not disappear
    expect(card?.scored).toBe("judged");
    expect(card!.matchPct!).toBeLessThan(100); // the family bar scored against zero
  });

  it("FALLBACK: with years genuinely unaccounted for (an unplaced job), the career total stands in — an unknown never lowers", async () => {
    const unaccounted = await seededDeck(
      [block("b1", 2014, 2018), block("b2", 2019, 2023)], // same 10y, but b2 was never placed
      { b1: placed([OTHER]) },
    );
    const knownZero = await seededDeck(
      [block("b1", 2014, 2018), block("b2", 2019, 2023)],
      { b1: placed([OTHER]), b2: placed([OTHER]) },
    );
    const fallbackCard = await compoundCard(unaccounted);
    const zeroCard = await compoundCard(knownZero);
    expect(fallbackCard?.matchPct).toBe(100); // family bar fell back to the 10y total
    expect(zeroCard!.matchPct!).toBeLessThan(fallbackCard!.matchPct!); // a known zero is not an unknown
  });

  it("with no resolvable family at all, the career total is the fallback (the pre-#222 reading)", async () => {
    const unscoped = await seededDeck(
      [block("b1", 2014, 2023)],
      { b1: placed([OTHER]) },
      "none", // no floor, and the default placeFamily seam answers unmapped
    );
    const card = await compoundCard(unscoped);
    expect(card?.matchPct).toBe(100); // 10y total against both bars, generous never strict
  });

  // #222 QA finding 1 — the SHIPPED journey never walks the production-discovery flow, so the
  // scoped reading must be reachable from the target-role placement alone. No floor is pinned
  // here; only the placeFamily seam (the one the deck route now consults) knows the family.
  it("the scoped reading is live on the shipped journey: no pinned floor, target-role placement alone", async () => {
    const shipped = await seededDeck(
      [block("b1", 2014, 2018), block("b2", 2019, 2023)], // 10y total, all placed, none in FAMILY
      { b1: placed([OTHER]), b2: placed([OTHER]) },
      "placement",
    );
    const card = await compoundCard(shipped);
    expect(card?.scored).toBe("judged");
    expect(card!.matchPct!).toBeLessThan(100); // the known zero fired — not the career-total reading
  });
});

// --- the confidence attenuation, on a real card score ------------------------------------------

describe("#222 confidence attenuates the card's score (#231 AC6, owner weights x1.0/x0.9/x0.75)", () => {
  const cardAt = async (confidence: PlacementConfidence) =>
    compoundCard(await seededDeck([block("b1", 2016, 2023)], { b1: placed([FAMILY], confidence) }));

  it("likely scores lower than certain, and possible lower still — at exactly the owner's weights", async () => {
    const certain = await cardAt("certain");
    const likely = await cardAt("likely");
    const possible = await cardAt("possible");
    expect(certain?.matchPct).toBe(100); // 8y in family, judge found everything
    expect(likely?.matchPct).toBe(90); // x0.9 — an 80% card would read 72%
    expect(possible?.matchPct).toBe(75); // x0.75 — the owner's own worked case
  });

  it("attenuation fires on the SHIPPED journey too — target-role placement alone, no pinned floor (QA finding 1)", async () => {
    const shipped = await seededDeck(
      [block("b1", 2016, 2023)],
      { b1: placed([FAMILY], "possible") },
      "placement",
    );
    expect((await compoundCard(shipped))?.matchPct).toBe(75);
  });

  it("no card is withdrawn or filtered by confidence — a possible placement sinks a card, never removes it", async () => {
    const possible = await cardAt("possible");
    expect(possible).toBeDefined();
    expect(possible?.scored).toBe("judged");
  });

  it("the confidence level itself is never printed on the card", async () => {
    const harness = await seededDeck([block("b1", 2016, 2023)], { b1: placed([FAMILY], "possible") });
    const res = await harness.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie: harness.cookie } });
    expect(res.payload).not.toMatch(/"confidence"|"possible"|"likely"|"certain"/);
  });

  it("a zero or fallback family number rests on no placement — no attenuation applies", async () => {
    // All jobs `possible` in the OTHER family: the advert's family number is a known zero derived
    // from where the jobs are NOT, and no ordinal hedges that — the low score IS the message.
    const knownZero = await seededDeck(
      [block("b1", 2014, 2023)],
      { b1: placed([OTHER], "possible") },
    );
    const certainZero = await seededDeck(
      [block("b1", 2014, 2023)],
      { b1: placed([OTHER], "certain") },
    );
    expect((await compoundCard(knownZero))?.matchPct).toBe((await compoundCard(certainZero))?.matchPct);
  });
});
