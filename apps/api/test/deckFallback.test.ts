// #228 (spec #241) — the target family ran out: she is OFFERED the work her CV proves, and chooses.
//
// The layers the spec's testing decisions ask for, each asserted on what a person can observe:
//   - the offer's four preconditions (deckFallback.ts), including the one that keeps a visitor out
//     of an empty room: no eligible published family her CV proves, no offer;
//   - the one-way latch, which is what bounds the ticket to a single extra search;
//   - the retrieval request in both scopes, and that the two fingerprints DIFFER — the mechanism
//     itself, tested rather than assumed;
//   - the money, at the deck route with a COUNTING fake retriever: a decline pays for nothing, an
//     acceptance pays for exactly one search, and polling or accepting twice pays for nothing more;
//   - the years scope in fallback (spec decision 9) — the silent failure this ticket would otherwise
//     ship: her real years in the family she is being shown, never her zero in the one she left.
import { describe, expect, it, vi } from "vitest";
import type {
  AdRequirementsV1,
  FamilyPlacement,
  JobBlockView,
  MinedEndValue,
  MinedJobBlock,
} from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { advertFamilyIdFor, resolveSessionYears } from "../src/deck.js";
import { applyFallbackChoice, fallbackOffer } from "../src/deckFallback.js";
import { cvProvenFloors, fallbackFamilyFor } from "../src/adaptiveDiscovery.js";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
  type ProductionFamilyPublicationValue,
} from "../src/familyFloors.js";
import { InMemoryClaimStore } from "../src/claims.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { InMemorySessionStore, type SessionRecord } from "../src/sessions.js";
import { refreshWorkedYears } from "../src/yearsWorked.js";
import { retrievalFingerprint, retrievalRequestForSession } from "../src/postingRetrieval.js";
import type { Posting } from "../src/preview.js";

const TARGET = "field-marketing"; // the family she TYPED her way into — the deck that runs out
const PROVEN = "it-project-delivery"; // the one really published family — what her CV proves
const SECOND_BEST = "product-management";

const placed = (familyIds: string[]): FamilyPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  families: familyIds.map((familyId) => ({ familyId, version: 1 })),
  confidence: "certain",
});

const decision = <T>(value: T) => ({
  id: "decision",
  value,
  origin: { kind: "worked_out" as const },
  machine_touch: null,
  classification: null,
});

/** One dated job record placed in `familyIds`, worked January `from` to December `to`. Ended dates
 *  throughout, so the years never move with the clock. */
function block(id: string, familyIds: string[], from: number, to: number): JobBlockView {
  const end: MinedEndValue = { state: "ended", date: { year: to, month: 12, precision: "month" } };
  return {
    id,
    kind: "job",
    countsTowardExperience: true,
    employer: decision(`Employer ${id}`),
    title: decision("Regional PM"),
    start: decision({ year: from, month: 1, precision: "month" as const }),
    end: decision(end),
    kindDecision: decision("job" as const),
    family: decision(familyIds.length ? placed(familyIds) : null),
    confirmed: true,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const REAL = initialProductionFamilyFloors().get(PROVEN, 1)!;
const publication = (familyId: string, version = 1): ProductionFamilyPublicationValue => ({
  ...REAL,
  floor: { ...REAL.floor, familyId, version },
});
const registry = (...publications: ProductionFamilyPublicationValue[]): Pick<ProductionFamilyFloorStore, "active"> => ({
  active: (familyId) => publications.find((p) => p.floor.familyId === familyId) ?? null,
});

const session = (over: Partial<SessionRecord> = {}) =>
  ({
    id: "s1",
    targetTitles: ["Product Analytics Manager"],
    intent: { targetRole: "Product Analytics Manager", searchAreas: [{ text: "Hong Kong" }] },
    discovery: {
      questionFloors: [{ familyId: TARGET, version: 1 }],
      searchFamily: { familyId: TARGET, version: 1 },
      coveredItemIds: [],
      checkpoint: "essential_floor_covered",
      fallback: { declined: false, family: null },
    },
    ...over,
  }) as unknown as SessionRecord;

const widened = (family = { familyId: PROVEN, version: 1 }) =>
  session({
    discovery: { ...session().discovery, fallback: { declined: false, family } },
  } as Partial<SessionRecord>);

const CV = [block("b1", [PROVEN], 2010, 2019)];
const PUBLISHED = registry(publication(PROVEN));

describe("#228 the offer's preconditions (spec decision 2)", () => {
  const offer = (over: Parameters<typeof fallbackOffer>[0] | null, moreQuestions: boolean) =>
    fallbackOffer(over ?? session(), moreQuestions, CV, PUBLISHED);

  it("offers at the dead end: nothing left to ask, a family her CV proves", () => {
    expect(offer(null, false)).toMatchObject({ offered: true, declined: false, active: false });
  });

  // Story 13 / AC 1: the cheapest improvement is tried first — with a question left she goes back to
  // the interview, and the expensive widening is never raised.
  it("does not offer while a question remains", () => {
    expect(offer(null, true).offered).toBe(false);
  });

  // Story 15: never invite her into an empty room. Her CV proves nothing we can search — an
  // unpublished family, or no dated job records at all — so today's dead end stands, unchanged.
  it("does not offer when her CV proves no eligible published family", () => {
    expect(fallbackOffer(session(), false, CV, registry()).offered).toBe(false);
    expect(fallbackOffer(session(), false, [], PUBLISHED).offered).toBe(false);
  });

  // Offering to re-run the search she just exhausted would spend a provider call to return the very
  // deck she has already swiped through.
  it("does not offer the family the deck was already searched with", () => {
    const sameFamily = session({
      discovery: { ...session().discovery, searchFamily: { familyId: PROVEN, version: 1 } },
    } as Partial<SessionRecord>);
    expect(fallbackOffer(sameFamily, false, CV, PUBLISHED).offered).toBe(false);
  });

  // AC 9 / story 7: a reload after a "no" does not ask again. The screen keeps the way back.
  it("does not raise the offer again once she has declined it", () => {
    const declined = session({
      discovery: { ...session().discovery, fallback: { declined: true, family: null } },
    } as Partial<SessionRecord>);
    expect(fallbackOffer(declined, false, CV, PUBLISHED)).toMatchObject({
      offered: false,
      declined: true,
      active: false,
    });
  });

  // AC 12 / story 17: the fallback deck runs out too. Same honest ending, no third widening.
  it("does not offer again once the widening is already active", () => {
    expect(fallbackOffer(widened(), false, CV, PUBLISHED)).toMatchObject({
      offered: false,
      active: true,
    });
  });

  // AC 3 / decision 12: her typed words are the only thing the offer names.
  it("carries her typed words and nothing else the screen could name a family from", () => {
    const state = offer(null, false);
    expect(state.targetRole).toBe("Product Analytics Manager");
    expect(Object.keys(state).sort()).toEqual(["active", "declined", "offered", "targetRole"]);
    expect(JSON.stringify(state)).not.toContain(PROVEN);
  });
});

describe("#228 her answer (the one-way latch, spec decision 7)", () => {
  const store = () => {
    const sessions = new InMemorySessionStore();
    const written: Array<{ declined: boolean; family: { familyId: string } | null }> = [];
    return {
      written,
      setDiscoveryFallback: vi.fn(async (_id: string, fallback: Parameters<InMemorySessionStore["setDiscoveryFallback"]>[1]) => {
        written.push(fallback);
        return { ...session().discovery, fallback };
      }) as unknown as InMemorySessionStore["setDiscoveryFallback"],
      sessions,
    };
  };

  it("accepting pins her strongest proven family, once — a second acceptance re-pins nothing", async () => {
    const s = store();
    const first = await applyFallbackChoice(s, session(), true, CV, PUBLISHED);
    expect(first).toMatchObject({ active: true, offered: false });
    expect(s.written).toEqual([{ declined: false, family: { familyId: PROVEN, version: 1 } }]);

    const again = await applyFallbackChoice(
      s,
      widened(),
      true,
      [block("b2", ["some-other-family"], 2020, 2024), ...CV],
      registry(publication(PROVEN), publication("some-other-family")),
    );
    expect(again).toMatchObject({ active: true });
    expect(s.written).toHaveLength(1); // nothing written the second time: the latch held
  });

  // AC 9: declining is remembered, so a reload never re-raises the question by itself — the screen
  // keeps the offer reachable instead.
  it("declining is remembered and buys no family", async () => {
    const s = store();
    const declined = await applyFallbackChoice(s, session(), false, CV, PUBLISHED);
    expect(declined).toMatchObject({ declined: true, active: false, offered: false });
    expect(s.written).toEqual([{ declined: true, family: null }]);
  });

  it("accepting when her CV proves nothing searchable records no widening", async () => {
    const s = store();
    expect(await applyFallbackChoice(s, session(), true, [], PUBLISHED)).toMatchObject({ active: false });
    expect(s.written).toEqual([]);
  });
});

describe("#228 the fallback family and the retrieval request (spec decisions 4/5/6)", () => {
  it("takes her strongest CV family — the same ranking the interview already uses", () => {
    const blocks = [block("b1", [PROVEN], 2015, 2017), block("b2", ["alpha"], 2000, 2019)];
    const published = registry(publication(PROVEN), publication("alpha"));
    expect(cvProvenFloors(blocks, published).map((f) => f.familyId)).toEqual(["alpha", PROVEN]);
    expect(fallbackFamilyFor(blocks, published, null)).toEqual({ familyId: "alpha", version: 1 });
  });

  it("names the fallback family instead of her target's, under a NEW fingerprint", () => {
    const target = retrievalRequestForSession(session(), [], []);
    const fallback = retrievalRequestForSession(widened(), [], []);

    expect(target).toMatchObject({ family: { familyId: TARGET, version: 1 }, fallback: false });
    expect(fallback).toMatchObject({ family: { familyId: PROVEN, version: 1 }, fallback: true });
    // The new fingerprint IS the "exactly one extra search" mechanism: it forces one retrieval, and
    // every later read of the unchanged session reuses that one snapshot.
    expect(retrievalFingerprint(fallback)).not.toBe(retrievalFingerprint(target));
  });
});

describe("#228 years are read at the fallback family's scope (spec decision 9)", () => {
  const facts = [
    { dimension: "years-experience", familyId: ANY_FAMILY, value: "9" },
    { dimension: "years-experience", familyId: PROVEN, value: "9" },
  ] as Parameters<typeof resolveSessionYears>[0];

  it("scores her fallback cards on her real years in that family, not her zero in the one she left", async () => {
    const unused = async () => placed([TARGET]);
    expect(await advertFamilyIdFor(session(), unused)).toBe(TARGET);
    expect(await advertFamilyIdFor(widened(), unused)).toBe(PROVEN);

    // The target deck: every counting job is placed, none of them in the family she is aiming at —
    // a KNOWN zero, and the honest number to score her target-family cards against.
    expect(resolveSessionYears(facts, CV, TARGET)).toMatchObject({ family: 0, familySource: "zero" });
    // The fallback deck, which is the whole point: nine years, from her own dated job records.
    expect(resolveSessionYears(facts, CV, PROVEN)).toMatchObject({ family: 9, familySource: "fact" });
  });
});

// The money. Everything above is arithmetic; this is the bill (AC 4/5/6, stories 22/23).
describe("#228 what a fallback costs, at the deck route", () => {
  function minedBlock(id: string, startYear = 2010, endYear = 2019): MinedJobBlock {
    const stamp = (value: string) => ({
      value,
      source_quote: value,
      machine_touch: "verbatim" as const,
      classification: "Verified" as const,
    });
    return {
      id,
      employer: stamp("Employer"),
      title: stamp("Regional PM"),
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
      kind: stamp("job") as MinedJobBlock["kind"],
    };
  }

  /** A retriever that counts every call and returns one advert named after the family it was asked
   *  for, so "which deck am I looking at?" is answerable from the cards themselves. */
  function countingRetriever() {
    const calls: Array<{ familyId: string | null; fallback: boolean }> = [];
    const retrievePostings = vi.fn(async (input: { family: { familyId: string } | null; fallback: boolean }) => {
      calls.push({ familyId: input.family?.familyId ?? null, fallback: input.fallback });
      const now = new Date().toISOString();
      const familyId = input.family?.familyId ?? "word";
      return {
        schemaVersion: "4" as const,
        outcome: "relevant_postings" as const,
        postings: [
          {
            schemaVersion: "4" as const,
            id: `posting:${familyId}`,
            canonicalKey: `${familyId}-advert`,
            title: `${familyId} lead`,
            company: "Live Co",
            location: "Hong Kong",
            sourceUrl: `https://example.com/${familyId}`,
            excerpt: "A live advert retrieved for this deck.",
            postedAt: now,
            capturedAt: now,
            verifiedLiveAt: now,
            expiresAt: null,
            attribution: [],
            sources: [{ providerId: "techmap", providerPostingId: familyId }],
            skills: ["Delivery"],
            language: "en",
          },
        ],
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
        retrievedAt: now,
      };
    });
    return { calls, retrievePostings };
  }

  /** Every live advert reads as belonging to the family whose search returned it (its id carries
   *  that family) — the family-fit stamp the real reader produces, without a model. */
  const readAd = async (posting: Posting): Promise<AdRequirementsV1> => ({
    schemaVersion: "1",
    adId: posting.id,
    curated: false,
    language: "en",
    familyFit: { family: posting.id.replace("posting:", ""), confidence: 0.9 },
    requirements: [
      {
        id: "delivery",
        band: "essential",
        kind: "ordinary",
        requirement: "Deliver work",
        sourceSpan: "delivery",
      },
    ],
  });

  async function harness() {
    const jobBlocks = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    const sessions = new InMemorySessionStore();
    const claims = new InMemoryClaimStore();
    await jobBlocks.init();
    const { calls, retrievePostings } = countingRetriever();
    const { app } = buildServer({ jobBlocks, eligibility, sessions, claims, retrievePostings, readAd });
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((c) => c.name === "jc_session")!.value}`;
    const sessionId = created.json().id as string;
    await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Product Analytics Manager", searchArea: "Hong Kong" },
    });
    // Her CV: nine years in the one really published family. Her target role sits elsewhere.
    await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks: [minedBlock("b1")] }, "{}");
    await jobBlocks.label(sessionId, "b1", placed([PROVEN]));
    await refreshWorkedYears(jobBlocks, eligibility, sessionId);
    const pinned = { familyId: TARGET, version: 1 };
    await sessions.reconcileDiscoveryState(sessionId, { questionFloors: [pinned], searchFamily: pinned }, [], true);

    const cards = async () => {
      const res = await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
      return res.json() as { cards: Array<{ adId: string }>; fallback: { offered: boolean; declined: boolean; active: boolean } };
    };
    const choose = async (accepted: boolean) =>
      (
        await app.inject({
          method: "POST",
          url: "/onboarding/cards/fallback",
          headers: { cookie },
          payload: { accepted },
        })
      ).json() as { fallback: { declined: boolean; active: boolean } };
    // The first read fires the target search in the background; the second serves its snapshot.
    await cards();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    return { app, cookie, calls, cards, choose, claims, eligibility, sessionId };
  }

  async function retryHarness({ secondBest = false }: { secondBest?: boolean } = {}) {
    const jobBlocks = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    const sessions = new InMemorySessionStore();
    await jobBlocks.init();
    const { calls, retrievePostings } = countingRetriever();
    const labelJobBlocks = async (sessionId: string) => {
      await jobBlocks.label(sessionId, "b1", placed([PROVEN]));
      await refreshWorkedYears(jobBlocks, eligibility, sessionId);
    };
    const { app } = buildServer({
      jobBlocks,
      eligibility,
      sessions,
      retrievePostings,
      readAd,
      productionFamilyFloors: secondBest
        ? ({
            active: (familyId: string) =>
              familyId === SECOND_BEST ? publication(SECOND_BEST) : PUBLISHED.active(familyId),
          } as ProductionFamilyFloorStore)
        : undefined,
      pipeline: { labelJobBlocks },
    });
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((c) => c.name === "jc_session")!.value}`;
    const sessionId = created.json().id as string;
    await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Product Analytics Manager", searchArea: "Hong Kong" },
    });
    await sessions.setTargetTitles(sessionId, ["Product Analytics Manager"]);
    await jobBlocks.ingest(
      sessionId,
      { schemaVersion: "1", blocks: secondBest ? [minedBlock("b1"), minedBlock("b2", 2022, 2023)] : [minedBlock("b1")] },
      "{}",
    );
    if (secondBest) {
      await jobBlocks.label(sessionId, "b2", placed([SECOND_BEST]));
      await refreshWorkedYears(jobBlocks, eligibility, sessionId);
    }
    const pinned = { familyId: TARGET, version: 1 };
    await sessions.reconcileDiscoveryState(sessionId, { questionFloors: [pinned], searchFamily: pinned }, [], true);

    const cards = async () =>
      (
        await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })
      ).json() as { fallback: { offered: boolean; active: boolean } };
    const choose = async (accepted: boolean) =>
      (
        await app.inject({
          method: "POST",
          url: "/onboarding/cards/fallback",
          headers: { cookie },
          payload: { accepted },
        })
      ).json() as { fallback: { active: boolean } };
    return { calls, cards, choose };
  }

  it("a decline pays for nothing, and an acceptance pays for exactly one search — ever", async () => {
    const { calls, cards, choose } = await harness();
    expect(calls).toEqual([{ familyId: TARGET, fallback: false }]);

    // AC 4: she says no. No provider call, and the answer is remembered.
    expect(await choose(false)).toMatchObject({ fallback: { declined: true, active: false } });
    await cards();
    expect(calls).toHaveLength(1);

    // AC 5: she changes her mind. ONE more search, run against the family her CV proves.
    expect(await choose(true)).toMatchObject({ fallback: { active: true } });
    const widenedDeck = await cards();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ familyId: PROVEN, fallback: true });
    expect(widenedDeck.fallback).toMatchObject({ active: true, offered: false });

    // Polling the deck, and accepting a second time, buy nothing further.
    await cards();
    await cards();
    await choose(true);
    await cards();
    expect(calls).toHaveLength(2);
  });

  // AC 6 / decision 10: the widening REPLACES her deck. She has seen every advert in the family she
  // typed; re-showing them would bury what she asked for.
  it("replaces the deck: the target family's adverts do not come back", async () => {
    const { calls, cards, choose } = await harness();
    const before = await cards();
    expect(before.cards.some((card) => card.adId === `posting:${TARGET}`)).toBe(true);

    await choose(true);
    await cards();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const after = await cards();
    expect(after.cards.some((card) => card.adId === `posting:${PROVEN}`)).toBe(true);
    expect(after.cards.some((card) => card.adId === `posting:${TARGET}`)).toBe(false);
  });

  // #256 (coverage gap G1) — #229's sentence on the REAL path, now that a second family is
  // published. Untestable at the route until then: with one published family the fallback deck
  // always carried a years fact by construction, so "the flag drops" could not be distinguished
  // from "the flag never fired". Nothing here injects the flag or its inputs — the known zero is
  // derived by the server from her dated jobs, which is the whole point of the gap.
  it("drops the change-of-direction flag on the accepted widening", async () => {
    const { app, cookie, calls, cards, choose } = await harness();
    const deck = async () =>
      (await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })).json() as {
        newToFamily: boolean;
        cards: Array<{ adId: string; matchPct: number | null }>;
      };

    // Her typed family is a KNOWN zero — nine years, none of them here. The deck says so.
    expect((await deck()).newToFamily).toBe(true);

    // The widening she accepts is the work her CV proves, so the sentence stops — on a deck whose
    // family the server picked, not one a test flag pinned.
    await choose(true);
    await cards();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const widened = await deck();
    expect(widened.cards.some((c) => c.adId === `posting:${PROVEN}`)).toBe(true);
    expect(widened.newToFamily).toBe(false);
  });

  // #229's own inviolable rule, measured rather than asserted about: the sentence is copy. Closing
  // the known zero flips the flag on the SAME retrieved deck; every score must be exactly where it
  // was. A confirmed claim first, so the numbers being compared are real ones and not zeroes.
  it("says the sentence without touching a score", async () => {
    const { app, cookie, claims, eligibility, sessionId } = await harness();
    const deck = async () =>
      (await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })).json() as {
        newToFamily: boolean;
        cards: Array<{ adId: string; matchPct: number | null }>;
      };
    await claims.add(sessionId, {
      id: "delivery",
      role: "Employer — Regional PM",
      text: "Deliver work across the region.",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "Deliver work across the region.",
      needs_grill: false,
      grill_hint: null,
    });

    // The new claim is a new retrieval fingerprint: wait for that search's snapshot to land, so
    // the two reads being compared are the same deck.
    const spoken = await vi.waitFor(async () => {
      const read = await deck();
      expect(read.cards.length).toBeGreaterThan(0);
      return read;
    });
    expect(spoken.newToFamily).toBe(true);
    expect(spoken.cards.every((c) => (c.matchPct ?? 0) > 0)).toBe(true);

    // Years in this family now: nothing to say, and nothing said moves.
    await eligibility.put(sessionId, {
      dimension: "years-experience",
      familyId: TARGET,
      value: "9",
      label: "Years in field marketing",
    });
    const silent = await deck();
    expect(silent.newToFamily).toBe(false);
    expect(silent.cards.map((c) => c.matchPct)).toEqual(spoken.cards.map((c) => c.matchPct));
  });

  it("retries a null placement before accepting fallback work", async () => {
    const { calls, cards, choose } = await retryHarness();

    expect(await choose(true)).toMatchObject({ fallback: { active: true } });
    await cards();
    await vi.waitFor(() => expect(calls).toEqual([{ familyId: PROVEN, fallback: true }]));
  });

  it("retries before ranking fallback families, so the recovered strongest family wins", async () => {
    const { calls, cards, choose } = await retryHarness({ secondBest: true });

    expect(await choose(true)).toMatchObject({ fallback: { active: true } });
    await cards();
    await vi.waitFor(() => expect(calls).toEqual([{ familyId: PROVEN, fallback: true }]));
  });
});
