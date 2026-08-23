// #285 (spec #279, ADR-0014 decision 2 as amended) — years per industry, and the advert bar they
// finally answer. Mirrors familyYears.test.ts, the first axis's suite, seam for seam:
//   - pure computation table-driven (computeIndustryYears / industryPlacementConfidence / the
//     single writer's per-industry facts, at their prefixed scope keys);
//   - the scoring seam pure (answerIndustryBar: exact / near / far, known zero vs fallback, the
//     untestable unmapped-advert bar);
//   - the API surface: the deck route with a fake judge, real stores, labeled job records — the
//     compound advert's industry bar answered at its own scope, the near-industry ×0.9 card sink,
//     and the closeness × confidence composition (×0.675) on a REAL card score.
import { describe, expect, it } from "vitest";
import type {
  FamilyPlacement,
  IndustryPlacement,
  MinedJobBlock,
  PlacementConfidence,
} from "@jobcrush/contracts";
import { buildDeckServer as buildServer, injectSettled, liveIdFor } from "./fixtureDeck.js";
import type { JudgeFn } from "../src/judge.js";
import type { LlmClient } from "../src/llm.js";
import { makeJobBlockIndustryLabeler } from "../src/industryLabeler.js";
import { publishedIndustryVocabulary } from "../src/industryVocabulary.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { InMemorySessionStore } from "../src/sessions.js";
import {
  computeIndustryYears,
  hasIndustryUnplacedWork,
  industryPlacementConfidence,
  industryScopeKey,
  refreshWorkedYears,
} from "../src/yearsWorked.js";
import { answerIndustryBar, applyYearsShortfall, type YearsAtScopes } from "../src/judgedScore.js";

const FAMILY = "it-project-delivery"; // the advert's family — kept satisfied so only the industry bar moves
// The advert's industry bar (data/sample-ad-requirements.json): 8+ years in it-services.
const EXACT = "it-services"; // the advert's own industry
const NEAR = "software"; // same group (technology) — near
const FAR = "banking"; // financial-services — far
// The motivating advert: "8+ years of IT experience including 5+ years as a Project Manager" —
// an industry bar (it-services >= 8) and a family bar (>= 5), per #284's reading.
const COMPOUND_AD = liveIdFor("2026-07-05_endava-vietnam_senior-project-manager");

const VOCABULARY = publishedIndustryVocabulary();
const GROUP_OF: ReadonlyMap<string, string> = new Map(
  VOCABULARY.activeIndustries().map(({ industryId, groupId }) => [industryId, groupId]),
);

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

const placedFamily = (familyIds: string[] = [FAMILY]): FamilyPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  families: familyIds.map((familyId) => ({ familyId, version: 1 })),
  confidence: "certain",
});

const placedIndustry = (
  refs: Array<string | [string, PlacementConfidence]>,
): IndustryPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  industries: refs.map((ref) => {
    const [industryId, confidence] = Array.isArray(ref) ? ref : [ref, "certain" as const];
    return { industryId, version: VOCABULARY.active(industryId)?.version ?? 1, confidence };
  }),
});

const UNMAPPED: IndustryPlacement = { schemaVersion: "2", outcome: "unmapped" };

// A judge that finds every requirement fully evidenced, instantly — any movement in a card's
// matchPct below comes from the industry bar's answer / attenuation under test, nothing else.
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

/** A session with family- AND industry-labeled job records, facts synced, the family pinned — so
 *  the compound advert's family bar always passes and only its industry bar is in play. An entry
 *  absent from `industries` leaves that block industry-unlabeled (reads as unaccounted). */
async function seededDeck(
  blocks: MinedJobBlock[],
  industries: Record<string, IndustryPlacement>,
  families?: Record<string, FamilyPlacement>,
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
    judgeMaxCards: 99,
  });
  const cookie = await anonSession(server.app);
  const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
  const sessionId = me.json().id as string;
  await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks }, "{}");
  for (const b of blocks) {
    await jobBlocks.label(sessionId, b.id, families?.[b.id] ?? placedFamily());
  }
  for (const [blockId, placement] of Object.entries(industries)) {
    await jobBlocks.labelIndustry(sessionId, blockId, placement);
  }
  // Stands in for the labeler steps' own refresh — labels were written directly here.
  await refreshWorkedYears(jobBlocks, eligibility, sessionId);
  const pinned = { familyId: FAMILY, version: 1 };
  await sessions.reconcileDiscoveryState(sessionId, { questionFloors: [pinned], searchFamily: pinned }, [], true);
  return { app: server.app, cookie, sessionId, jobBlocks, eligibility };
}

async function compoundCard(harness: Awaited<ReturnType<typeof seededDeck>>) {
  const res = await injectSettled(harness.app, {
    method: "GET",
    url: "/onboarding/cards",
    headers: { cookie: harness.cookie },
  });
  const cards = (res.json() as { cards: Array<{ adId: string; matchPct: number | null; scored: string }> })
    .cards;
  return cards.find((c) => c.adId === COMPOUND_AD);
}

// --- pure computation, table-driven ------------------------------------------------------------

// The view the product itself computes: ingest + label through the real store, read back.
async function viewOf(blocks: MinedJobBlock[], industries: Record<string, IndustryPlacement>) {
  const store = new InMemoryJobBlockStore();
  await store.init();
  await store.ingest("s", { schemaVersion: "1", blocks }, "{}");
  for (const [blockId, placement] of Object.entries(industries)) {
    await store.labelIndustry("s", blockId, placement);
  }
  return store.list("s");
}

describe("#285 computeIndustryYears", () => {
  const now = new Date(Date.UTC(2026, 0, 1));

  it("a job carrying two industries contributes its FULL length to both — never split", async () => {
    const view = await viewOf([block("b1", 2018, 2023)], { b1: placedIndustry([EXACT, FAR]) });
    const perIndustry = computeIndustryYears(view, now);
    expect(perIndustry.get(EXACT)).toBe(6);
    expect(perIndustry.get(FAR)).toBe(6);
    // Which is why no surface may present a sum of industries as a figure: 6+6 != the 6-year career.
  });

  it("overlapping same-industry jobs merge — calendar months counted once per industry", async () => {
    const view = await viewOf(
      [block("b1", 2018, 2021), block("b2", 2020, 2023)],
      { b1: placedIndustry([EXACT]), b2: placedIndustry([EXACT]) },
    );
    expect(computeIndustryYears(view, now).get(EXACT)).toBe(6);
  });

  it("an unmapped job contributes to NO industry, and counts as unaccounted work", async () => {
    const view = await viewOf([block("b1", 2018, 2023), block("b2", 2010, 2015)], {
      b1: placedIndustry([EXACT]),
      b2: UNMAPPED,
    });
    expect(computeIndustryYears(view, now).size).toBe(1);
    expect(hasIndustryUnplacedWork(view)).toBe(true);
  });

  it("a never-labeled job is unaccounted too; every job placed → nothing unaccounted", async () => {
    expect(hasIndustryUnplacedWork(await viewOf([block("b1", 2018, 2023)], {}))).toBe(true);
    expect(
      hasIndustryUnplacedWork(await viewOf([block("b1", 2018, 2023)], { b1: placedIndustry([EXACT]) })),
    ).toBe(false);
  });
});

describe("#285 industryPlacementConfidence", () => {
  it("is the WEAKEST contributing reference's level PER INDUSTRY, and null with no contributor", async () => {
    // #282 moved confidence onto each reference: one job certain of banking, possible of consulting.
    const view = await viewOf(
      [block("b1", 2018, 2023), block("b2", 2010, 2015)],
      {
        b1: placedIndustry([[FAR, "certain"], ["consulting", "possible"]]),
        b2: placedIndustry([[FAR, "likely"]]),
      },
    );
    expect(industryPlacementConfidence(view, FAR)).toBe("likely");
    expect(industryPlacementConfidence(view, "consulting")).toBe("possible");
    expect(industryPlacementConfidence(view, EXACT)).toBeNull();
  });
});

// --- the single writer: one fact per industry, prefixed, beside the family facts ---------------

describe("#285 the single writer stores one fact per industry, and keeps them honest", () => {
  it("writes prefixed per-industry facts and leaves the career total each-job-counted-once", async () => {
    const { sessionId, eligibility } = await seededDeck(
      [block("b1", 2018, 2023), block("b2", 2010, 2015)],
      { b1: placedIndustry([EXACT, FAR]), b2: placedIndustry([FAR]) },
    );
    expect(await eligibility.numeric(sessionId, "years-experience", industryScopeKey(EXACT))).toBe(6);
    expect(await eligibility.numeric(sessionId, "years-experience", industryScopeKey(FAR))).toBe(12);
    // The total is NOT a sum of industries (6 + 12): each job counted once.
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(12);
  });

  it("an industry correction re-derives at the door: the old industry's fact removed, the new one written", async () => {
    const { app, cookie, sessionId, eligibility } = await seededDeck(
      [block("b1", 2018, 2023)],
      { b1: placedIndustry([EXACT]) },
    );
    expect(await eligibility.numeric(sessionId, "years-experience", industryScopeKey(EXACT))).toBe(6);

    const res = await app.inject({
      method: "POST",
      url: "/job-blocks/b1/correct",
      headers: { cookie },
      payload: {
        key: "industry",
        value: { industryId: FAR, version: VOCABULARY.active(FAR)!.version },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(await eligibility.numeric(sessionId, "years-experience", industryScopeKey(FAR))).toBe(6);
    expect(await eligibility.get(sessionId, "years-experience", industryScopeKey(EXACT))).toBeNull();
  });

  it("confidence NEVER changes the years fact, at any scope (#231 AC6's rule on the second axis)", async () => {
    const factAt = async (confidence: PlacementConfidence) => {
      const { sessionId, eligibility } = await seededDeck(
        [block("b1", 2016, 2023)],
        { b1: placedIndustry([[EXACT, confidence]]) },
      );
      return eligibility.numeric(sessionId, "years-experience", industryScopeKey(EXACT));
    };
    expect(await factAt("certain")).toBe(8);
    expect(await factAt("likely")).toBe(8);
    expect(await factAt("possible")).toBe(8);
  });
});

// --- the labeler is a door too -----------------------------------------------------------------

describe("#285 the industry labeling step re-derives the facts it just made true", () => {
  it("after makeJobBlockIndustryLabeler runs, the industry facts exist without any other door touched", async () => {
    const store = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    await store.init();
    await store.ingest("s", { schemaVersion: "1", blocks: [block("b1", 2018, 2023)] }, "{}");
    const llm: LlmClient = {
      complete: async () =>
        JSON.stringify({
          why: "because",
          outcome: "confirmed",
          industries: [{ industryId: EXACT, confidence: "certain" }],
        }),
    };
    await makeJobBlockIndustryLabeler(
      llm,
      VOCABULARY.activeIndustries(),
      store,
      undefined,
      undefined,
      undefined,
      eligibility,
    )("s");
    expect(await eligibility.numeric("s", "years-experience", industryScopeKey(EXACT))).toBe(6);
  });
});

// --- the scoring seam, pure: how one industry bar is answered ----------------------------------

describe("#285 answerIndustryBar", () => {
  const bar = (yearsIndustry?: string) =>
    ({
      id: "r1",
      band: "nice-to-have",
      kind: "ordinary",
      requirement: "8+ years of IT experience",
      comparable: { op: ">=", value: 8 },
      eligibilityDimension: "years-experience",
      yearsScope: "industry",
      ...(yearsIndustry ? { yearsIndustry } : {}),
      sourceSpan: "8+ years of IT experience",
    }) as const;
  const years = (industries: Partial<YearsAtScopes["industries"]>): YearsAtScopes => ({
    family: 5,
    total: 10,
    industries: {
      years: new Map(),
      confidence: new Map(),
      hasUnplaced: false,
      groupOf: GROUP_OF,
      ...industries,
    },
  });

  it("exact: her years in the advert's industry, at full weight", () => {
    const answer = answerIndustryBar(
      years({ years: new Map([[EXACT, 8]]), confidence: new Map([[EXACT, "certain"]]) }),
      bar(EXACT),
    );
    expect(answer).toEqual({ years: 8, closeness: "exact", confidence: "certain" });
  });

  it("near: the SAME whole years number, marked near — never a reduced fact", () => {
    const answer = answerIndustryBar(years({ years: new Map([[NEAR, 8]]) }), bar(EXACT));
    expect(answer).toEqual({ years: 8, closeness: "near", confidence: null });
  });

  it("far is far: a career in another group contributes nothing — the KNOWN zero", () => {
    const answer = answerIndustryBar(years({ years: new Map([[FAR, 8]]) }), bar(EXACT));
    expect(answer).toEqual({ years: 0, closeness: null, confidence: null });
  });

  it("while any job is unplaced, the generous career total stands in — an unknown never deletes", () => {
    const answer = answerIndustryBar(years({ years: new Map([[FAR, 8]]), hasUnplaced: true }), bar(EXACT));
    expect(answer).toEqual({ years: 10, closeness: null, confidence: null });
  });

  it("an advert naming no published industry is UNTESTABLE — null, verdict untouched", () => {
    expect(answerIndustryBar(years({ years: new Map([[EXACT, 8]]) }), bar()).years).toBeNull();
    expect(answerIndustryBar(years({ years: new Map([[EXACT, 8]]) }), bar("aerospace")).years).toBeNull();
  });

  it("with no industry context wired at all, the pre-#285 reading (the career total) holds", () => {
    expect(answerIndustryBar({ family: 5, total: 10 }, bar(EXACT))).toEqual({
      years: 10,
      closeness: null,
      confidence: null,
    });
  });

  it("an unmapped advert industry leaves every verdict completely untouched through applyYearsShortfall", () => {
    const verdicts = [{ requirementId: "r1", fit: 0.8, supportingFactId: null, reason: "t" }];
    const out = applyYearsShortfall(
      verdicts,
      { schemaVersion: "1", adId: "ad", language: "en", familyFit: { family: FAMILY, confidence: 0.9 }, requirements: [bar()] },
      years({ years: new Map() }),
    );
    expect(out).toEqual(verdicts);
  });
});

// --- the API surface: the industry bar at its own scope, on a real card ------------------------

describe("#285 the compound advert's industry bar is answered at its own scope (API surface)", () => {
  const eightYears = [block("b1", 2016, 2023)]; // 8y — meets both bars when they read her years

  it("EXACT: eight years in the advert's industry answer the bar in full — no attenuation", async () => {
    const card = await compoundCard(await seededDeck(eightYears, { b1: placedIndustry([EXACT]) }));
    expect(card?.scored).toBe("judged");
    expect(card?.matchPct).toBe(100);
  });

  it("NEAR: eight years in a same-group industry answer with the SAME whole number, and the card sinks ×0.9", async () => {
    const card = await compoundCard(await seededDeck(eightYears, { b1: placedIndustry([NEAR]) }));
    expect(card?.scored).toBe("judged");
    // The years fact stayed whole (8 >= 8, no shortfall) — the ×0.9 is the card's ranking, not her years.
    expect(card?.matchPct).toBe(90);
  });

  it("FAR: a career all in another group is a KNOWN zero — the bar fails, the card sinks but stays", async () => {
    const card = await compoundCard(await seededDeck(eightYears, { b1: placedIndustry([FAR]) }));
    expect(card).toBeDefined(); // never withdrawn — it sinks, it does not disappear
    expect(card?.scored).toBe("judged");
    // The bar scored against zero: on this advert the industry bar is a nice-to-have band, so the
    // known zero costs its band weight (100 → 94), not the whole card — a failed bar and a ×0.9
    // card attenuation are two different mechanisms and neither is derived from the other.
    expect(card!.matchPct!).toBeLessThan(100);
  });

  it("a known zero rests on no placement — confidence never softens or hardens it", async () => {
    const possible = await compoundCard(
      await seededDeck(eightYears, { b1: placedIndustry([[FAR, "possible"]]) }),
    );
    const certain = await compoundCard(await seededDeck(eightYears, { b1: placedIndustry([FAR]) }));
    expect(possible?.matchPct).toBe(certain?.matchPct);
  });

  it("FALLBACK: an industry-unlabeled job keeps the generous career-total reading — an unknown never lowers", async () => {
    const card = await compoundCard(await seededDeck(eightYears, {}));
    expect(card?.matchPct).toBe(100); // total 8 >= 8; nothing attenuates a number resting on no placement
  });

  it("closeness and placement confidence COMPOSE by multiplication: possible × near = ×0.675", async () => {
    const nearPossible = await compoundCard(
      await seededDeck(eightYears, { b1: placedIndustry([[NEAR, "possible"]]) }),
    );
    const exactPossible = await compoundCard(
      await seededDeck(eightYears, { b1: placedIndustry([[EXACT, "possible"]]) }),
    );
    expect(exactPossible?.matchPct).toBe(75); // ×0.75 — confidence alone
    expect(nearPossible?.matchPct).toBe(68); // ×0.675 — the spec's own worked case, rounded once
  });

  it("BOTH scopes at once: short in the family, full in the industry — the family bar is what fails", async () => {
    // 8y in the industry but only 4y in the advert's family: the industry bar passes whole, the
    // family bar (>= 5) reads 4 — so this card must score below the exact-match card, on the
    // family axis alone. One number is not made to answer two questions.
    const splitFamily = await seededDeck(
      [block("b1", 2020, 2023), block("b2", 2016, 2019)], // 4y FAMILY + 4y other family
      { b1: placedIndustry([EXACT]), b2: placedIndustry([EXACT]) },
      { b1: placedFamily(), b2: placedFamily(["field-marketing"]) },
    );
    const fullAtBoth = await seededDeck(eightYears, { b1: placedIndustry([EXACT]) });
    const cardSplit = await compoundCard(splitFamily);
    const cardFull = await compoundCard(fullAtBoth);
    expect(cardFull?.matchPct).toBe(100);
    expect(cardSplit!.matchPct!).toBeLessThan(cardFull!.matchPct!);
  });

  it("the confidence level and closeness are never printed on the card", async () => {
    const harness = await seededDeck(eightYears, { b1: placedIndustry([[NEAR, "possible"]]) });
    const res = await injectSettled(harness.app, {
      method: "GET",
      url: "/onboarding/cards",
      headers: { cookie: harness.cookie },
    });
    expect(res.payload).not.toMatch(/"closeness"|"near"|"possible"|"likely"|"certain"/);
  });
});
