// #243 — the advert's job family reaches the deck: identity decides deletion, confidence decides
// order. Driven through the pinned HTTP seam (GET /onboarding/cards) with fakes at the same
// OnboardingDeps seams every other deck test uses (readAd, placeFamily), plus orderCardsForReveal
// unit coverage for the confidence sink. The reader-side ACs (closed vocabulary, version fold /
// re-read) live in adReader.test.ts.
import { describe, expect, it } from "vitest";
import { PLACEMENT_SCHEMA_VERSION, type AdRequirementsV1, type FamilyPlacement } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { orderCardsForReveal, partitionByFamilyFit } from "../src/deck.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { lookupAdRequirements } from "../src/e5stub.js";
import { readCounters } from "../src/counters.js";

const DECK_FAMILY = "it-project-delivery"; // the one published production family, and now the
// vocabulary the curated pool's familyFit stamps speak (sample-ad-requirements.json)

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const getCards = async (app: ReturnType<typeof buildServer>["app"], cookie: string) =>
  (await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })).json() as {
    cards: Array<{ adId: string }>;
  };

const confirmed = (familyId: string): FamilyPlacement => ({
  schemaVersion: PLACEMENT_SCHEMA_VERSION,
  outcome: "confirmed",
  families: [{ familyId, version: 1 }],
  confidence: "certain",
});

/** A reader stamping every unfixtured posting into `family` — the wrong-family population the
 *  filter must delete (or keep, on a word deck). */
const readerStamping =
  (family: string, confidence = 0.9) =>
  async (posting: Posting): Promise<AdRequirementsV1 | null> => ({
    schemaVersion: "1",
    adId: posting.id,
    curated: false,
    language: "en",
    familyFit: { family, confidence },
    requirements: [
      { id: "pour-foundations", band: "essential", kind: "ordinary", requirement: "Pour foundations", sourceSpan: "foundations" },
    ],
  });

const fixtureAdIds = () =>
  loadPostings()
    .filter((p) => lookupAdRequirements(p.id).status === "found")
    .map((p) => p.id);

describe("#243 family-fit deletion at the deck (HTTP seam)", () => {
  // AC2: an advert whose family fit names another family does not appear in her deck — and the
  // deletion is counted (the ticket's own "without a number we will believe this worked").
  it("deletes wrong-family adverts from a family deck, counted on deck.family_dropped", async () => {
    const before = readCounters()["deck.family_dropped"];
    const { app } = buildServer({
      placeFamily: async () => confirmed(DECK_FAMILY),
      readAd: readerStamping("construction-site-delivery"),
    });
    const cookie = await anonSession(app);
    const { cards } = await getCards(app, cookie);

    // Every surviving card is a curated-pool advert (stamped it-project-delivery); every
    // construction-stamped read is gone, and each deletion was counted.
    expect(cards.length).toBeGreaterThan(0);
    const fixtures = new Set(fixtureAdIds());
    expect(cards.every((card) => fixtures.has(card.adId))).toBe(true);
    expect(readCounters()["deck.family_dropped"]).toBeGreaterThan(before);
  });

  // Decision 2's other half at the same seam: identity keeps, confidence never deletes — a weak
  // same-family advert stays in the deck whatever its confidence.
  it("keeps a same-family advert whatever its confidence", async () => {
    const { app } = buildServer({
      placeFamily: async () => confirmed(DECK_FAMILY),
      readAd: readerStamping(DECK_FAMILY, 0.05),
    });
    const cookie = await anonSession(app);
    const { cards } = await getCards(app, cookie);
    const fixtures = new Set(fixtureAdIds());
    expect(cards.some((card) => !fixtures.has(card.adId))).toBe(true); // the weak reads survived
  });

  // A word-search deck (no search family, no confirmed placement) has no family to compare
  // against: nothing is deleted, exactly the pre-#243 deck.
  it("deletes nothing on a word-search deck", async () => {
    const before = readCounters()["deck.family_dropped"];
    const { app } = buildServer({ readAd: readerStamping("construction-site-delivery") });
    const cookie = await anonSession(app);
    const { cards } = await getCards(app, cookie);
    const fixtures = new Set(fixtureAdIds());
    expect(cards.some((card) => !fixtures.has(card.adId))).toBe(true); // the reads are all still here
    expect(readCounters()["deck.family_dropped"]).toBe(before);
  });

  // AC4 / decision 4: the comparison family is the family THIS DECK WAS SEARCHED FOR — #228's
  // fallback deck is a different family on purpose, and comparing it to the VISITOR's family would
  // delete every card in it on arrival. Here the visitor's own placement names another family,
  // while the pinned search family matches the pool's stamps: everything survives.
  it("compares against the deck's search family, never the visitor's placement", async () => {
    const built = buildServer({
      placeFamily: async () => confirmed("visitors-own-family"),
      readAd: readerStamping(DECK_FAMILY),
    });
    const cookie = await anonSession(built.app);
    const me = await built.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    await built.sessions.reconcileDiscoveryState(
      me.json().id as string,
      {
        questionFloors: [{ familyId: DECK_FAMILY, version: 1 }],
        searchFamily: { familyId: DECK_FAMILY, version: 1 },
      },
      [],
      false,
    );
    const { cards } = await getCards(built.app, cookie);
    expect(cards.length).toBeGreaterThan(0); // compared to the visitor's family, this would be 0
    const fixtures = new Set(fixtureAdIds());
    expect(cards.some((card) => !fixtures.has(card.adId))).toBe(true); // live reads survive too
  });
});

describe("#243 partitionByFamilyFit / confidence ranking (unit)", () => {
  const candidate = (adId: string, family: string) => ({
    adReq: { familyFit: { family, confidence: 0.9 } } as AdRequirementsV1,
    adId,
  });

  it("null deck family keeps everything; a mismatch or 'none of these' is dropped and counted", () => {
    const pool = [candidate("a", DECK_FAMILY), candidate("b", "other-family"), candidate("c", "none of these")];
    expect(partitionByFamilyFit(pool, null)).toEqual({ kept: pool, dropped: 0 });
    const before = readCounters()["deck.family_dropped"];
    const { kept, dropped } = partitionByFamilyFit(pool, DECK_FAMILY);
    expect(kept.map((entry) => entry.adId)).toEqual(["a"]);
    expect(dropped).toBe(2);
    expect(readCounters()["deck.family_dropped"]).toBe(before + 2);
  });

  // AC3: an advert naming her family with low confidence appears, ranked below higher-confidence
  // cards — rank is matchPct × confidence within a provenance tier; the DISPLAYED matchPct is the
  // card's own, untouched.
  it("a weak family-fit confidence sinks a card's rank without touching its score", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "strong-but-unsure", matchPct: 80, scored: "judged" as const }, curated: false, familyConfidence: 0.5 },
      { card: { adId: "weaker-but-sure", matchPct: 60, scored: "judged" as const }, curated: false, familyConfidence: 0.95 },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual(["weaker-but-sure", "strong-but-unsure"]);
    expect(ordered.map((card) => card.matchPct)).toEqual([60, 80]); // ranking only — scores intact
  });

  it("without familyConfidence (a word deck) the ordering is exactly the pre-#243 score sort", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "second", matchPct: 60, scored: "judged" as const }, curated: false },
      { card: { adId: "first", matchPct: 80, scored: "judged" as const }, curated: false },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual(["first", "second"]);
  });
});
