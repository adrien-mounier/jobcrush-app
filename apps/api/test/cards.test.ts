// #19 the reveal + the job card (screen 2a) — the pinned HTTP seam: GET /onboarding/cards over a
// real request, driven through the real discovery flow (prior art: discovery.test.ts). Asserts
// the response the frontend is pinned against, not handler internals: card shape, score-sorted
// order, and that a recorded "no" lands in askedClosed (never re-asked, never a gap).
import { describe, expect, it, vi } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildDeckCards, hasOpenDiscoveryQuestions, newToFamily, orderCardsForReveal, resolveSessionYears, withReadTimeout, mapWithConcurrency, type SessionYears } from "../src/deck.js";
// #63: the deck is fed by retrieval alone now, so the suite builds its server with the curated
// corpus wired at that seam — same adverts, same requirement sets, reached the way production
// reaches them. See fixtureDeck.ts.
import { buildDeckServer as buildServer, coverEssentialFloor, fixtureReadAd, injectSettled, liveIdFor, livePostings, seedRetrievalSnapshot, warmRetrieval } from "./fixtureDeck.js";
import { buildItProjectDeliveryServer } from "./placedServer.js";
import { listAdRequirements } from "../src/e5stub.js";
import type { Posting } from "../src/preview.js";
import { languageEligible } from "../src/language.js";
import { makeAdReader } from "../src/adReader.js";
import { InMemoryAdRequirementsStore } from "../src/adRequirementsStore.js";
import { readCounters } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";
import { answerLanguageLevel } from "../src/languageLevel.js";
import { ANY_FAMILY, type EligibilityFact } from "../src/eligibility.js";
import { discoveryClaimId } from "../src/discovery.js";
import { initialProductionFamilyFloors, productionDiscoveryFamily } from "../src/familyFloors.js";
import type { ClaimRecord } from "../src/claims.js";

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  injectSettled(app, { method: "GET", url, headers: { cookie } });
const post = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  url: string,
  payload?: unknown,
) => app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = liveIdFor("2026-07-05_endava-vietnam_senior-project-manager");
// #255: pinned by reference — the registry holds more than one family now, and this suite's
// sessions live in it-project-delivery.
const DISCOVERY_FAMILY = productionDiscoveryFamily(initialProductionFamilyFloors(), [
  { familyId: "it-project-delivery", version: 1 },
])!;
const END_TO_END = "end-to-end-delivery";
const STAKEHOLDERS = "stakeholder-coordination";
const RISKS = "risk-dependency-control";
const COMMUNICATION = "delivery-communication";

async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

interface JobCard {
  adId: string;
  title: string;
  company: string;
  place: string;
  salary: string | null;
  pattern: string | null;
  scored: string;
  matchPct: number;
  bubble: { hit: string; open: string };
  fit: Array<{ id: string; text: string }>;
  dontYet: Array<{ id: string; band: string; requirement: string }>;
  askedClosed: Array<{ id: string; text: string }>;
  adExcerpt: string;
}

describe("#19 GET /onboarding/cards", () => {
  it("promotes one highest-scoring curated opener, then score-sorts every remaining card", () => {
    // scored: "judged" uniformly — every entry in the SAME group, so the judged/estimated/pending
    // grouping (#105 review round 4, extended by #117) is a no-op here and this test stays exactly
    // what it always was: proof the curated-opener promotion works, untouched by that review.
    const ordered = orderCardsForReveal([
      { card: { adId: "curated-low", matchPct: 70, scored: "judged" as const }, curated: true },
      { card: { adId: "wide-best", matchPct: 99, scored: "judged" as const }, curated: false },
      { card: { adId: "curated-high", matchPct: 80, scored: "judged" as const }, curated: true },
      { card: { adId: "wide-second", matchPct: 90, scored: "judged" as const }, curated: false },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual([
      "curated-high",
      "wide-best",
      "wide-second",
      "curated-low",
    ]);
  });

  // #105 review round 4: the ordering fix itself — a card scored by a real judgement and one that
  // fell back to the deterministic tick are not comparable (different scorers, and the fallback
  // scorer measurably over-scores), so mixing them in one score-sorted list put the over-scored
  // fallback card ahead of an honestly-judged one. #117 no longer calls this state "fallback" (that
  // number is only ever shown when no judge is wired at all — see "estimated" below), but the
  // grouping property is identical.
  it("ranks a judged card above a higher-scoring estimated card — different scorers are not comparable", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "estimated-high", matchPct: 90, scored: "estimated" as const }, curated: false },
      { card: { adId: "judged-low", matchPct: 40, scored: "judged" as const }, curated: false },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual(["judged-low", "estimated-high"]);
  });

  it("preserves score order WITHIN each group (judged, then estimated, then pending)", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "judged-low", matchPct: 20, scored: "judged" as const }, curated: false },
      { card: { adId: "estimated-high", matchPct: 95, scored: "estimated" as const }, curated: false },
      { card: { adId: "judged-high", matchPct: 80, scored: "judged" as const }, curated: false },
      { card: { adId: "estimated-low", matchPct: 10, scored: "estimated" as const }, curated: false },
      { card: { adId: "pending-only", matchPct: null, scored: "pending" as const }, curated: false },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual([
      "judged-high",
      "judged-low",
      "estimated-high",
      "estimated-low",
      "pending-only",
    ]);
  });

  it("the curated opener still wins over a judged card, even a lower-scoring curated estimated card", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "judged-high", matchPct: 90, scored: "judged" as const }, curated: false },
      { card: { adId: "curated-estimated", matchPct: 50, scored: "estimated" as const }, curated: true },
    ]);
    // The curated-opener rule (untouched by this review) still promotes the curated card to the
    // front regardless of the grouping.
    expect(ordered.map((card) => card.adId)).toEqual(["curated-estimated", "judged-high"]);
  });

  // #117: a curated card is the deck's usual opener regardless of score — but a PENDING one has no
  // verdict at all yet, and promoting it would put the deck's headline card in front claiming no
  // number, exactly the lie AC5 forbids. Of the two options the ticket allows (judge it inside the
  // bound, or leave it unpromoted), routes/onboarding.ts picks the simpler one: leave it unpromoted.
  it("does not promote a curated card that is still pending — the opener needs a real number", () => {
    const ordered = orderCardsForReveal([
      { card: { adId: "judged-mid", matchPct: 60, scored: "judged" as const }, curated: false },
      { card: { adId: "curated-pending", matchPct: null, scored: "pending" as const }, curated: true },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual(["judged-mid", "curated-pending"]);
  });

  it("rides the anonymous session (no wall) and mirrors the session's own persisted stage", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stage: string; cards: JobCard[] };
    expect(body.stage).toBe(me.json().stage); // reveal-gated client-side, not blocked server-side
    expect(body.cards.length).toBeGreaterThanOrEqual(3);
  });

  it("leads with a curated posting and keeps another real card behind the reveal", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: JobCard[] };
    // #103 (and code-review fold-in): derive the expected set through the real production
    // predicate — languageEligible against each entry's POSTING language (detected at ingest, not
    // the fixture's own hand-authored string) and its requirement set's OWN language field — rather
    // than a hardcoded `=== "en"` the test would silently drift from production. A stubbed
    // requirement set exists for a non-English posting AND for a mismatched-language posting (both
    // added to prove the gate); neither may resolve to a card.
    const allPostings = livePostings(); // #63: cards carry retrieved ids now, not fixture ids
    const readerLangs = ["en"]; // readingLanguages()'s default for this anonymous session
    const allRequirements = listAdRequirements().filter((ad) => {
      const posting = allPostings.find((p) => p.id === liveIdFor(ad.adId));
      return (
        !!posting &&
        languageEligible(posting.language, readerLangs) &&
        languageEligible(ad.language, readerLangs)
      );
    });
    expect(body.cards.map((card) => card.adId).sort()).toEqual(
      allRequirements.map((ad) => liveIdFor(ad.adId)).sort(),
    ); // every ENGLISH requirement set resolves to a real posting and reaches the HTTP deck
    expect(body.cards[1]).toBeDefined(); // passing the reveal card cannot exhaust the deck
    const curatedIds = new Set(
      allRequirements
        .filter((ad) => ad.curated)
        .map((ad) => liveIdFor(ad.adId)),
    );
    expect(curatedIds.has(body.cards[0]!.adId)).toBe(true);
    expect(body.cards[0]!.matchPct).toBe(
      Math.max(...body.cards.filter((card) => curatedIds.has(card.adId)).map((card) => card.matchPct)),
    );
  });

  // #22: the reveal's account wall applies only to a still-anonymous visitor — the client decides
  // whether to show it off this one bit, so it must track the session's claimed state precisely.
  it("authed is false for a still-anonymous session", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    expect(res.json().authed).toBe(false);
  });

  it("authed is true once the anon→account merge has claimed the session", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "e22@example.com");

    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    expect(res.json().authed).toBe(true);
  });

  it("card shape, score-sorted order, and a recorded 'no' surfacing in askedClosed", async () => {
    const { app } = buildItProjectDeliveryServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    // Two essential "yes" answers → confirmed facts (fit); one essential "no" → a negative
    // (askedClosed).
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: END_TO_END,
      answer: "Yes",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: RISKS,
      answer: "No",
    });
    // #63: the reveal is now refused outright until the whole essential floor is answered, so the
    // last item is answered here too. It was always part of the floor; before #63 an uncovered
    // session was quietly served the fixture pool anyway, which is exactly what this ticket closes.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: COMMUNICATION,
      answer: "Yes",
    });

    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stage: string; cards: JobCard[] };
    // #106: stage no longer flips to deck on the essential band alone — eligibility questions
    // are now pending and none were answered here. /onboarding/cards itself is never gated on stage
    // (comment a few lines below, unchanged), so this is a pure echo-of-session-state check.
    expect(body.stage).toBe("discovery");

    expect(body.cards.length).toBeGreaterThanOrEqual(3);

    // Card shape — every field the pinned contract promises, on every card.
    for (const card of body.cards) {
      expect(card).toMatchObject({
        schemaVersion: "1",
        adId: expect.any(String),
        title: expect.any(String),
        company: expect.any(String),
        place: expect.any(String),
        matchPct: expect.any(Number),
        breakdown: {
          essential: { met: expect.any(Number), total: expect.any(Number) },
          desirable: { met: expect.any(Number), total: expect.any(Number) },
        },
        bubble: { hit: expect.any(String), open: expect.any(String) },
        adExcerpt: expect.any(String),
      });
      expect(card.salary).toBeNull(); // absent in the stub postings
      expect(card.pattern).toBeNull();
      expect(card.matchPct).toBeGreaterThanOrEqual(0);
      expect(card.matchPct).toBeLessThanOrEqual(100);
      expect(card.breakdown.essential.met).toBeLessThanOrEqual(card.breakdown.essential.total);
      expect(card.breakdown.desirable.met).toBeLessThanOrEqual(card.breakdown.desirable.total);
      expect(Array.isArray(card.fit)).toBe(true);
      expect(Array.isArray(card.dontYet)).toBe(true);
      expect(Array.isArray(card.askedClosed)).toBe(true);
      for (const req of card.dontYet) {
        // #102: unified band vocabulary — dontYet[].band is not rendered by the web app, so carrying
        // the new names here is invisible on screen (still only asserting "one of the three legal
        // band values", unchanged in intent).
        expect(["essential", "standard", "nice-to-have"]).toContain(req.band);
      }
    }

    // After the curated opener exception, every remaining card is score-sorted.
    for (let i = 2; i < body.cards.length; i++) {
      expect(body.cards[i]!.matchPct).toBeLessThanOrEqual(body.cards[i - 1]!.matchPct);
    }

    // The two "yes" answers are confirmed positives → every card's fit list.
    const fitIds = body.cards[0]!.fit.map((f) => f.id);
    expect(fitIds).toContain(discoveryClaimId(END_TO_END));
    expect(fitIds).toContain(discoveryClaimId(STAKEHOLDERS));

    // #311 (#287 c4): the recorded "no" is NOT recited on every card any more — a denial is named
    // only on a posting that asks for it in words the denial covers, with a two-shared-words floor
    // (the QA gate's defect 1: one common word had a single "No" recited across most of the deck).
    // This floor question is compound ("…risks, dependencies, timelines, or budgets?") and shares
    // at most one word with any clause of these fixture adverts, so under the stated words-not-
    // paraphrase ceiling it is named NOWHERE — and never a confirmed fact. The positive path (a
    // denial named on an ad that asks in matching words) is pinned by tailor.test.ts's #311 suite
    // and the cross-ad assertion at the end of this file's tailor-"no" test.
    for (const card of body.cards) {
      expect(card.askedClosed.map((f) => f.id)).not.toContain(discoveryClaimId(RISKS));
      expect(card.fit.map((f) => f.id)).not.toContain(discoveryClaimId(RISKS));
    }
  });

  // #106 code-review D1 (2026-08-03, round 3): buildJobCard built askedClosed unfiltered from EVERY
  // negative claim, so a declined eligibility question — which has nothing to do with any one ad's
  // requirements — showed up on every single card in the deck as if it were that ad's own closed gap.
  it("a declined eligibility question never shows up in any card's askedClosed (D1)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find(
      (q: { eligibility?: { dimension: string } }) => q.eligibility?.dimension === "work-rights",
    )!;
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });

    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.length).toBeGreaterThan(0);
    for (const card of body.cards) {
      expect(card.askedClosed.map((f) => f.id)).not.toContain(`discovery-${workRights.itemId}`);
      expect(card.fit.map((f) => f.id)).not.toContain(`discovery-${workRights.itemId}`);
    }
  });

  // #102 QA follow-up: every assertion above is shape-only (matchPct: expect.any(Number)), so a
  // mis-mapped band would silently shift every percentage and this whole file would still pass —
  // exactly the failure #86's owner named as the reason for unifying the vocabulary: "A mistranslated
  // band does not crash anything. It quietly reports the wrong match percentage, and no test and no
  // reader can tell by looking." Removing the translation removed the risk; this pins the detector.
  //
  // A characterization test, not a spec: the exact numbers below are measured from an actual run of
  // this deck against these discovery answers, not derived from the scoring rules. Slice 4 replaces
  // the scorer and is EXPECTED to move them on purpose — that forced, conscious re-baseline is the
  // point of this test, not a maintenance cost to avoid.
  it("characterization: pins the exact matchPct and breakdown per card for the known fixture deck", async () => {
    const { app } = buildItProjectDeliveryServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: END_TO_END,
      answer: "Yes",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: RISKS,
      answer: "No",
    });
    // #63: the reveal is now refused outright until the whole essential floor is answered, so the
    // last item is answered here too. It was always part of the floor; before #63 an uncovered
    // session was quietly served the fixture pool anyway, which is exactly what this ticket closes.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: COMMUNICATION,
      answer: "Yes",
    });
    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const byAdId = Object.fromEntries(
      body.cards.map((c) => [c.adId, { matchPct: c.matchPct, breakdown: c.breakdown }]),
    );
    expect(byAdId).toEqual({
      [liveIdFor("2026-06-30_schneider-electric_senior-project-manager")]: {
        matchPct: 32,
        breakdown: { essential: { met: 1, total: 3 }, desirable: { met: 0, total: 4 } },
      },
      [liveIdFor("2026-07-01_transunion_senior-project-manager-6-months-contract")]: {
        matchPct: 34,
        breakdown: { essential: { met: 0, total: 4 }, desirable: { met: 0, total: 4 } },
      },
      [liveIdFor("2026-07-05_computershare-hong-kong_business-readiness-senior-project-manager-9-month-contract")]: {
        matchPct: 22,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      // #222: the compound years sentence became two scoped bars (total 8 / family 5), so this ad
      // carries one more desirable requirement than before and the token tick shifts with it.
      [liveIdFor("2026-07-05_endava-vietnam_senior-project-manager")]: {
        matchPct: 24,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      [liveIdFor("2026-07-05_hire-feed_project-manager-remote")]: {
        matchPct: 30,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 4 } },
      },
      [liveIdFor("2026-07-05_manulife_senior-it-project-manager-delivery-manager")]: {
        matchPct: 32,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      [liveIdFor("2026-07-05_synpulse_business-analyst-project-manager-wealth-management-data")]: {
        matchPct: 22,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      [liveIdFor("2026-07-09_luvo-talent_senior-project-manager")]: {
        matchPct: 24,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 4 } },
      },
    });
  });

  // #29: a requirement declined while tailoring an ad must be asked-and-closed on that ad's DECK card
  // too — spec #37, "the list of open things only ever shrinks". #23 filtered negatives in the tailor
  // assembly only, deliberately, so #19's deck payload stayed byte-identical while it shipped.
  it("a requirement answered 'no' in Tailor leaves that ad's deck card gaps, and only that ad's", async () => {
    const { app } = buildItProjectDeliveryServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    for (const itemId of DISCOVERY_FAMILY.items.map((item) => item.id)) {
      await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: "Yes, definitely" });
    }
    await signIn(app, cookie, "tailor-no-hides-gap@example.com"); // the want/tailor routes are post-wall

    const cardOf = async (adId: string): Promise<JobCard> => {
      const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
      return body.cards.find((c) => c.adId === adId)!;
    };

    const before = await cardOf(VALID_AD_ID);
    expect(before.dontYet.length).toBeGreaterThan(0); // sanity: there IS a gap to decline
    const declined = before.dontYet[0]!;

    // Another ad's card, to pin AC3 — tailorClaimId is scoped by adId, so this must not move.
    const otherAdId = ((await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] }).cards
      .map((c) => c.adId)
      .find((id) => id !== VALID_AD_ID)!;
    const otherBefore = await cardOf(otherAdId);

    expect((await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`)).statusCode).toBe(200);
    const answered = await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: declined.id,
      answer: "No",
    });
    expect(answered.statusCode).toBe(200);

    const after = await cardOf(VALID_AD_ID);
    // AC1: gone from "Where you don't — yet".
    expect(after.dontYet.map((r) => r.id)).not.toContain(declined.id);
    // AC2: present exactly once under "Asked and closed", never in both lists.
    const closedIds = after.askedClosed.map((f) => f.id);
    const claimId = closedIds.filter((id) => id.endsWith(`-${declined.id}`));
    expect(claimId).toHaveLength(1);
    // D1, now shared: the bubble's open clause can't keep naming the declined requirement either.
    expect(after.bubble.open).not.toBe(declined.requirement);

    // AC3: an ad the visitor never tailored still renders its gaps exactly as before — the filter is
    // scoped by adId (tailorClaimId), so it must not shrink another ad's list.
    const otherAfter = await cardOf(otherAdId);
    expect(otherAfter.dontYet).toEqual(otherBefore.dontYet);
    expect(otherAfter.bubble).toEqual(otherBefore.bubble);
    expect(otherAfter.matchPct).toBe(otherBefore.matchPct);
    // #311 (#287 c4): no longer session-wide. The other ad names this denial ONLY because it asks
    // for the same capability in words the denial covers (these fixture adverts share requirement
    // phrasing); an ad that asked for nothing like it would stay untouched — the "named only on the
    // postings that actually ask for it" rule, pinned at the unit seam in tailor.test.ts's #311 suite.
    expect(otherAfter.askedClosed.length).toBe(otherBefore.askedClosed.length + 1);
  });

  // #103 (E5 slice 2): the AC this whole ticket hinges on, proven at the HTTP seam rather than by
  // inspection — a non-English posting (with a requirement set that WOULD join into a card without
  // the language gate, same as any English one) is retained and labelled in the pool, and never
  // reaches the deck for a default English-only session.
  it("retains a non-English posting in the pool, labelled, and never surfaces it as a card", async () => {
    const zh = livePostings().find((p) => p.id === liveIdFor("2026-07-10_huaxin-tech-shenzhen_it-xiangmu-jingli"));
    expect(zh).toBeDefined(); // present in the pool
    expect(zh!.language).toBe("zh"); // labelled at ingest

    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(zh!.id); // absent from the deck
  });

  // #103 code review finding 5: the posting's own excerpt reads English (so posting.language is
  // "en" and it passes THAT half of the gate), but its stubbed requirement set is deliberately
  // declared language "zh" — proving the deck also checks the requirement set's OWN language field,
  // not just the posting's, so foreign-language bullets can never render into an English-gated card.
  it("holds back a card whose posting reads English but whose requirement set is declared a different language", async () => {
    const adId = "2026-07-01_hays_senior-front-office-project-manager-top-tier-investment";
    const posting = livePostings().find((p) => p.id === liveIdFor(adId));
    expect(posting!.language).toBe("en"); // the posting itself passes the posting-language gate

    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(liveIdFor(adId)); // still held back on the ad's own language
  });
});

describe("#21 POST /onboarding/cards/:adId/want", () => {
  it("sets the signed-in session to tailor for the selected card and persists it on /sessions/me", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "want-success@example.com");
    // #63: an advert exists for this session only once retrieval has delivered it, and /want does
    // not wait on retrieval the way the deck does. Read the deck first, exactly as a visitor does.
    await warmRetrieval(app, cookie);

    const res = await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stage: "tailor", adId: VALID_AD_ID });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("tailor");
    expect(me.json().tailorAdId).toBe(VALID_AD_ID);
  });

  it("requires a claimed session and leaves anonymous state unchanged", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);

    const res = await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "login_required", message: "login required" } });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("deck");
    expect(me.json().tailorAdId).toBeNull();
  });

  it("fails closed with a 404 for an unknown card id and leaves the signed-in session state unchanged", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "want-unknown@example.com");

    const res = await post(app, cookie, "/onboarding/cards/not-a-real-card/want");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "unknown card" } });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("deck");
    expect(me.json().tailorAdId).toBeNull();
  });
});

// Every posting WITHOUT a hand-authored fixture — the population #104 makes readable. Module-scoped
// (not local to the #104 describe below) so #115's tests can reuse it too, rather than
// re-implementing the same fixture-first-else-reader predicate a second time.
const uncachedEnglishPostings = () =>
  livePostings()
    .filter((p) => p.language === "en")
    .filter((p) => fixtureReadAd(p) === null);

// A minimal valid AdRequirementsV1 for any adId — module-scoped for the same reason as
// uncachedEnglishPostings above (#115 review: don't re-implement a fixture that already exists).
const stubRequirements = (adId: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.6 },
  requirements: [
    {
      id: "own-a-budget",
      band: "essential",
      kind: "ordinary",
      requirement: "Own a project budget",
      sourceSpan: "budget",
    },
  ],
});

// #104 (E5 slice 3) — the tracer bullet: a posting nobody hand-curated becomes a card. Driven
// entirely through the HTTP boundary with fakes injected at OnboardingDeps.readAd — the pinned
// primary seam — rather than reaching into resolveAdRequirements or adReader.ts directly.
describe("#104 GET /onboarding/cards — reading uncached adverts", () => {
  it("adds a card for every posting with no hand-authored fixture once a reader is wired (the demoable 8→15 growth)", async () => {
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };

    // The same fixture-first-else-reader predicate resolveAdRequirements uses: with a reader always
    // answering, every English posting resolves to a card.
    const expectedIds = livePostings()
      .filter((p) => p.language === "en")
      .filter((p) => {
        const curated = fixtureReadAd(p);
        return curated ? languageEligible(curated.language, ["en"]) : true; // no fixture -> the fake reader supplies a valid English entry
      })
      .map((p) => p.id);
    expect(body.cards.map((c) => c.adId).sort()).toEqual(expectedIds.sort());
    // Exactly 15, not the ticket's demo figure of 16 — coordinator decision: of the 16 English
    // postings, `2026-07-01_hays_…` DOES have a hand-authored requirement set, deliberately built
    // by #103 to prove the dual language gate, and that fixture is declared Chinese. Reading it
    // live anyway would regress a shipped safety rule just to make a demo number match. A hard
    // number here (not toBeGreaterThan) fails if a card silently vanishes.
    expect(body.cards.length).toBe(15);

    const previouslyUnfixtured = uncachedEnglishPostings()[0]!;
    const newCard = body.cards.find((c) => c.adId === previouslyUnfixtured.id);
    expect(newCard).toBeDefined();
    expect(newCard!.dontYet.map((r) => r.requirement)).toContain("Own a project budget"); // a real list, not an empty stub
  });

  it("a second deck request, and a different session, make no additional read call for an already-read advert", async () => {
    const store = new InMemoryAdRequirementsStore();
    const calls: string[] = [];
    const llm: LlmClient = {
      async complete(prompt: string) {
        calls.push(prompt);
        return JSON.stringify({
          language: "en",
          familyFit: { family: "IT Project Manager", confidence: 0.6 },
          requirements: [
            {
              id: "own-a-budget",
              band: "essential",
              kind: "ordinary",
              requirement: "Own a project budget",
              sourceSpan: "budget",
            },
          ],
        });
      },
    };
    const { app } = buildServer({ readAd: makeAdReader(llm, store, [{ familyId: "IT Project Manager", label: "IT Project Manager", scope: "Delivering IT projects" }], []) });

    const cookie1 = await anonSession(app);
    await get(app, cookie1, "/onboarding/cards");
    const firstCallCount = calls.length;
    expect(firstCallCount).toBeGreaterThan(0); // sanity: there really were unfixtured postings to read

    await get(app, cookie1, "/onboarding/cards"); // same session, requested again
    const cookie2 = await anonSession(app); // a genuinely different session/user
    await get(app, cookie2, "/onboarding/cards");

    expect(calls.length).toBe(firstCallCount); // requirements are shared, never re-derived on read
  });

  it("a model response that fails validation drops only that advert; the rest of the deck survives, and the failure is counted", async () => {
    const [failing, surviving] = uncachedEnglishPostings();
    const store = new InMemoryAdRequirementsStore();
    const llm: LlmClient = {
      async complete(prompt: string) {
        if (prompt.includes(failing!.excerpt.slice(0, 60))) return "not valid json"; // fails both attempts
        return JSON.stringify({
          language: "en",
          familyFit: { family: "IT Project Manager", confidence: 0.6 },
          requirements: [
            {
              id: "own-a-budget",
              band: "essential",
              kind: "ordinary",
              requirement: "Own a project budget",
              sourceSpan: "budget",
            },
          ],
        });
      },
    };
    const before = readCounters()["postings.read_failed"];
    const { app } = buildServer({ readAd: makeAdReader(llm, store, [{ familyId: "IT Project Manager", label: "IT Project Manager", scope: "Delivering IT projects" }], []) });
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };

    expect(body.cards.map((c) => c.adId)).not.toContain(failing!.id); // no card, no fabricated number
    expect(body.cards.map((c) => c.adId)).toContain(surviving!.id); // the rest of the deck survives
    expect(readCounters()["postings.read_failed"]).toBe(before + 1); // and the failure is counted
  });

  // Pre-#104, tailorTarget()/loadAdRequirements() threw for anything not in the fixture set, which
  // would 500 on every newly-readable job the deck could now show — the shared resolveAdRequirements
  // fixes this at every call site, proven here end to end: want → tailor, never a 500.
  it("a newly-read advert (no fixture) can be wanted and tailored without a 500", async () => {
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await signIn(app, cookie, "newly-read-tailor@example.com");
    await warmRetrieval(app, cookie); // #63: the advert reaches this session through retrieval
    const uncached = uncachedEnglishPostings()[0]!;

    const wantRes = await post(app, cookie, `/onboarding/cards/${uncached.id}/want`);
    expect(wantRes.statusCode).toBe(200);

    const tailorRes = await get(app, cookie, "/onboarding/tailor");
    expect(tailorRes.statusCode).toBe(200);
    expect((tailorRes.json() as { card: JobCard }).card.adId).toBe(uncached.id);
  });
});

// #104 review finding 10: an injected reader has no timeout of its own, and the deck route awaits
// every posting's resolution before responding — one hung provider call would hang the app's main
// screen indefinitely. Tested directly against withReadTimeout's own short-ms seam (a real 15s wait
// has no place in this suite); resolveAdRequirements's use of it (drop + count on any rejection) is
// already proven by the "drops only that advert" HTTP test above, since a timeout's eventual effect
// on that call site is identical to any other rejection.
describe("#104 withReadTimeout", () => {
  it("rejects a hung promise after the given ms, without waiting for it to ever settle", async () => {
    const hung = new Promise(() => {}); // never resolves or rejects
    await expect(withReadTimeout(hung, 20)).rejects.toThrow(/timed out/);
  });

  it("resolves normally when the promise settles before the deadline", async () => {
    await expect(withReadTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("propagates the original rejection when the promise fails before the deadline (not a timeout error)", async () => {
    await expect(withReadTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });
});

// #105 review round 3, cheap fix: QA read the worker-pool implementation and believed it correct —
// this proves it, rather than leaving CARD_RESOLUTION_CONCURRENCY's bound as an unverified read. The
// judgement cache is per-SESSION and never warms across users (unlike the ad-read cache), so an
// uncapped fan-out turns concurrent visitors into a multiplied burst of model calls; this is the one
// thing standing between that and a rate-limit storm.
describe("#105 mapWithConcurrency", () => {
  it("never runs more than `limit` callbacks in flight, and still resolves every item correctly", async () => {
    const items = [0, 1, 2, 3, 4, 5];
    const limit = 2;
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];

    const promise = mapWithConcurrency(items, limit, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      inFlight--;
      return n * 2;
    });

    // Proven SYNCHRONOUSLY, before a single microtask has run — not inferred from timing: calling
    // mapWithConcurrency starts exactly `limit` workers immediately (each runs up to its own first
    // `await` before control returns here), never all 6 items at once. This IS the concurrency cap.
    expect(inFlight).toBe(limit);

    // Drain one at a time; each release lets exactly one new worker start (peak must never climb
    // past `limit` as later items begin), until every item has run.
    let released = 0;
    while (released < items.length) {
      if (resolvers.length > 0) {
        resolvers.shift()!();
        released++;
      }
      await Promise.resolve();
    }

    const results = await promise;
    expect(peak).toBeLessThanOrEqual(limit);
    expect(results).toEqual(items.map((n) => n * 2)); // every item resolved, in its original order
  });

  it("never starts more workers than there are items", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (n) => n * 10);
    expect(results).toEqual([10, 20]);
  });
});

// #116 — the deck's read phase has ONE shared wall-clock budget, not a fresh READ_TIMEOUT_MS per
// concurrency-cap wave. Staging 2026-10-01: 8 fresh adverts at a cap of 6 are two waves, 2 × 15s
// reached the web proxy's 30s, the proxy reset the socket, and the owner's first screen was
// "Couldn't line up your jobs." — for a deck whose reads were all still running fine. The judge phase
// got this exact fix in #105 (judgeCards.test.ts proves it on a real clock); this proves the read
// phase on a fake one. buildDeckCards directly, not HTTP, so Date can be faked in lockstep with the
// timers (the shared deadline is Date.now()-based) without touching session/cookie machinery.
describe("#116 the deck holds its reveal under ONE shared read budget", () => {
  const posting = (n: number): Posting => ({
    id: `cold-${n}`, // no fixture → resolveAdRequirements falls through to the reader
    title: `Cold job ${n}`,
    company: "Nobody",
    location: "Paris",
    keywords: [],
    excerpt: "an advert nobody has read yet",
    language: "en",
  });
  const input = () => ({
    confirmed: [],
    negatives: [],
    facts: [],
    blocks: [],
    years: resolveSessionYears([], [], null),
    deckFamilyId: null,
    langs: ["en"],
  });

  it("every read hanging: responds after the one budget (never waves × READ_TIMEOUT_MS), with no cards and the reads counted still-running", async () => {
    const postings = Array.from({ length: 13 }, (_, n) => posting(n)); // three waves at a cap of 6
    const hungForever = () => new Promise<AdRequirementsV1 | null>(() => {});
    const before = {
      timedOut: readCounters()["postings.read_timed_out"],
      held: readCounters()["deck.reveal_held"],
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let settled: Awaited<ReturnType<typeof buildDeckCards>> | undefined;
      const run = buildDeckCards(postings, input(), { readAd: hungForever }).then((r) => (settled = r));
      await vi.advanceTimersByTimeAsync(15_000); // the whole budget, once
      await vi.advanceTimersByTimeAsync(100); // later waves get ~0ms each — flush them
      await run;
      expect(settled).toBeDefined(); // per-wave stacking would still be waiting for 30s more
      expect(settled!.cards).toEqual([]);
      expect(settled!.unread).toBe(13);
    } finally {
      vi.useRealTimers();
    }
    // Only the first wave (6, the cap) was ever started and timed out; the other 7 were never raced
    // against a spent budget — no timeout counted, no "timeout" failure entry, no read leaked past
    // the cap. The re-ask starts them with a fresh budget.
    expect(readCounters()["postings.read_timed_out"]).toBe(before.timedOut + 6);
    expect(readCounters()["deck.reveal_held"]).toBe(before.held + 1);
  });

  it("every read landing in time: the deck is built as before, nothing held", async () => {
    const readAd = async (p: Posting) => stubRequirements(p.id);
    const held = readCounters()["deck.reveal_held"];
    const result = await buildDeckCards([posting(1), posting(2)], input(), { readAd });
    expect(result.unread).toBe(0);
    expect(result.cards.map((c) => c.adId)).toEqual(expect.arrayContaining(["cold-1", "cold-2"]));
    expect(readCounters()["deck.reveal_held"]).toBe(held);
  });
});

// #115 — the confirmed cause of staging's read-failure spike: a read that legitimately takes longer
// than the deck's own READ_TIMEOUT_MS (15s), not a validation/contract problem (measured: 10/10 real
// reads succeeded with zero validation retries; the deadline, not the model, was the failure mode).
// The owner's chosen fix keeps the 15s deadline exactly as it is and instead (a) stops counting a
// timeout as a read failure, alarmed on its own terms, (b) relies on — and here pins — the fact that
// the underlying read keeps running after the deadline fires and still persists, so the NEXT request
// serves it from cache, and (c) makes the reason retrievable over HTTP, gated behind OPS_KEY since
// it can carry raw-ish upstream error text. Driven at the HTTP boundary (spec #86's primary seam)
// with fake timers standing in for the real 15s wait, same "a real 15s wait has no place in this
// suite" reasoning as the block above — only setTimeout/clearTimeout are faked so Fastify's own
// transport plumbing runs on real timers.
describe("#115 a timed-out read is not a read failure", () => {
  const validResponse = () =>
    JSON.stringify({
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        {
          id: "own-a-budget",
          band: "essential",
          kind: "ordinary",
          requirement: "Own a project budget",
          sourceSpan: "budget",
        },
      ],
    });

  const OPS_KEY = "test-ops-key-115";

  // Polls rather than assuming a fixed number of microtask hops between resolving the underlying
  // model call and store.put() actually landing (completeWithCost → extractJson/parse → store.put →
  // the inFlight promise's .finally is several awaits deep, and that count is an implementation
  // detail this test shouldn't pin) — a broken chain now times out this helper with a clear message
  // instead of silently flaking on the exact hop count.
  async function waitUntilStored(store: InMemoryAdRequirementsStore, adId: string, timeoutMs = 2000) {
    const start = Date.now();
    for (;;) {
      const found = await store.get(adId);
      if (found) return found;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntilStored: ${adId} never landed in the store`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it("the deck holds its reveal (#116: searching, no cards) while the slow read runs, does not miscount it as a read failure, counts and alarms it as a timeout separately, still persists the paid-for read, exposes the reason (gated) over HTTP, and the later request reveals the whole deck from cache with no second model call", async () => {
    const uncached = uncachedEnglishPostings()[0]!;

    const store = new InMemoryAdRequirementsStore();
    const calls: string[] = [];
    let resolveSlow!: (text: string) => void;
    const slow = new Promise<string>((resolve) => {
      resolveSlow = resolve;
    });
    const llm: LlmClient = {
      async complete(prompt: string) {
        calls.push(prompt);
        // Only THIS advert's call hangs — every other uncached posting must still resolve normally,
        // or the whole deck (not just one card) would wait on the fake clock.
        if (prompt.includes(uncached.excerpt.slice(0, 60))) return slow;
        return validResponse();
      },
    };
    const before = {
      failed: readCounters()["postings.read_failed"],
      timedOut: readCounters()["postings.read_timed_out"],
      held: readCounters()["deck.reveal_held"],
    };
    const built = buildServer({ readAd: makeAdReader(llm, store, [{ familyId: "IT Project Manager", label: "IT Project Manager", scope: "Delivering IT projects" }], []) });
    const { app } = built;
    const cookie = await anonSession(app);
    // #63: the adverts reach this session through retrieval now, and the snapshot is written here
    // rather than earned by an extra deck request - that request would build a deck of its own and
    // hit the hung reader a second time, doubling every count this test pins.
    await seedRetrievalSnapshot(built, await sessionId(app, cookie));

    let res!: Awaited<ReturnType<typeof get>>;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // A raw inject, not `get`: injectSettled would re-ask on `searching` and the second ask would
      // wait on the same hung read against a fake clock nobody advances. One held response is the
      // whole subject here.
      const resPromise = app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
      await vi.advanceTimersByTimeAsync(15_000); // the real READ_TIMEOUT_MS, simulated rather than waited
      res = await resPromise;
    } finally {
      vi.useRealTimers(); // always restore, even if an assertion above throws mid-block
    }

    expect(res.statusCode).toBe(200); // no 500 — the slow advert holds the reveal, it is not fatal
    const body = res.json() as { cards: JobCard[]; searching: boolean };
    // #116 (owner's option A): the reveal is HELD, not shown short — no cards, "still looking", and
    // the client re-asks. The adverts that did read in time are not revealed without the slow one.
    expect(body.searching).toBe(true);
    expect(body.cards).toEqual([]);
    expect(readCounters()["deck.reveal_held"]).toBe(before.held + 1);

    expect(readCounters()["postings.read_failed"]).toBe(before.failed); // NOT counted as a read failure
    expect(readCounters()["postings.read_timed_out"]).toBe(before.timedOut + 1); // counted as a timeout

    // AC3, measured through the real HTTP-exposed derived numbers rather than raw counter diffs —
    // the failure alarm must be completely unmoved by a timeout, and the new timeout alarm must
    // reflect it: the other uncached postings in this same request settled in time (each counts as
    // postings.read_in_time), so this is one timeout among several in-time deadline outcomes — a
    // rate below the 60% threshold, not (only) a sample-size gate.
    const previousOpsKey = process.env.OPS_KEY;
    const countersRes = await app.inject({ method: "GET", url: "/ops/counters" });
    const counters = countersRes.json() as Record<string, number>;
    expect(counters["adReader.read_failure_alarm_firing"]).toBe(0);
    expect(counters["adReader.read_timeout_rate_per_mille"]).toBeGreaterThan(0);
    expect(counters["adReader.read_timeout_alarm_firing"]).toBe(0); // rate stays under the 60% threshold

    // AC2's retrievability, at the HTTP boundary spec #86 requires — not via recentReadFailuresList()
    // in-process. Gated: no key at all refuses; the right key returns the entry.
    const noKeyRes = await app.inject({ method: "GET", url: "/ops/read-failures" });
    expect(noKeyRes.statusCode).toBe(403);
    process.env.OPS_KEY = OPS_KEY;
    try {
      const failuresRes = await app.inject({ method: "GET", url: `/ops/read-failures?key=${OPS_KEY}` });
      expect(failuresRes.statusCode).toBe(200);
      const entry = (failuresRes.json() as { entries: Array<{ adId: string; class: string }> }).entries
        .filter((f) => f.adId === uncached.id)
        .at(-1);
      expect(entry?.class).toBe("timeout"); // the reason names the advert and the class

      // Nothing cancels the underlying call — it keeps running after the deadline and still persists.
      resolveSlow(validResponse());
      await waitUntilStored(store, uncached.id);

      const callsAfterFirstResolve = calls.length;
      const res2 = await get(app, cookie, "/onboarding/cards"); // a later request, real timers
      const body2 = res2.json() as { cards: JobCard[]; searching: boolean };
      expect(body2.searching).toBe(false); // every read landed — revealed once, whole
      expect(body2.cards.map((c) => c.adId)).toContain(uncached.id); // now served from cache
      expect(calls.length).toBe(callsAfterFirstResolve); // no second model call
    } finally {
      if (previousOpsKey === undefined) delete process.env.OPS_KEY;
      else process.env.OPS_KEY = previousOpsKey;
    }
  });

  // #115 round 2 finding 2: the one failure class with no pin. The regression this guards against is
  // a genuine rejection getting mis-sorted into the "timeout" bucket, which would MUTE a real failure
  // behind the counter split's own "this is fine, it'll self-heal" framing — precisely the outcome
  // this whole ticket exists to prevent. Same HTTP seam as the timeout test above.
  it("a readAd rejection that is not the timeout race is classified reader-rejected, never folded into the timeout bucket", async () => {
    const uncached = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      if (posting.id === uncached.id) throw new Error("boom - not a timeout");
      return stubRequirements(posting.id);
    };
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    // #63: settle retrieval BEFORE the measured window - the deck read that finishes retrieval is
    // a deck build like any other, and counting it here would double every number below.
    await warmRetrieval(app, cookie);
    const before = {
      failed: readCounters()["postings.read_failed"],
      timedOut: readCounters()["postings.read_timed_out"],
    };
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200); // no 500
    const body = res.json() as { cards: JobCard[]; searching: boolean };
    expect(body.cards.map((c) => c.adId)).not.toContain(uncached.id);
    // #116 AC3: a read that genuinely FAILED holds nothing — the deck is revealed without it, exactly
    // as #115 left it; only a read still running holds the reveal.
    expect(body.searching).toBe(false);
    expect(body.cards.length).toBeGreaterThan(0);

    expect(readCounters()["postings.read_failed"]).toBe(before.failed + 1); // a genuine failure...
    expect(readCounters()["postings.read_timed_out"]).toBe(before.timedOut); // ...never miscounted as a timeout

    const key = "test-ops-key-reader-rejected";
    const previousOpsKey = process.env.OPS_KEY;
    process.env.OPS_KEY = key;
    try {
      const failuresRes = await app.inject({ method: "GET", url: `/ops/read-failures?key=${key}` });
      const entry = (failuresRes.json() as { entries: Array<{ adId: string; class: string; message: string }> }).entries
        .filter((f) => f.adId === uncached.id)
        .at(-1);
      expect(entry?.class).toBe("reader-rejected");
      expect(entry?.message).toContain("boom - not a timeout");
    } finally {
      if (previousOpsKey === undefined) delete process.env.OPS_KEY;
      else process.env.OPS_KEY = previousOpsKey;
    }
  });
});

// --- #107 (E5 slice 6) — a job you genuinely cannot take leaves your deck --------------------------
// Every AC driven through the pinned HTTP boundary (spec #86's primary seam) — AC5 is explicit that a
// withdrawal must be observed as the card's ABSENCE from the deck through the API, never an internal
// predicate. findWithdrawingRequirement has its own direct unit tests too (withdrawal.test.ts), in
// ADDITION to these, never instead of them.
//
// Module-scoped (T4, code review): shared by every #107 describe below, not redefined per block.
const mandarinBlocking = (adId: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.6 },
  requirements: [
    {
      id: "mandarin-required",
      band: "essential",
      kind: "blocking",
      requirement: "Fluent Mandarin required",
      eligibilityDimension: "language",
      eligibilitySubject: "Mandarin",
      sourceSpan: "Fluent Mandarin is required for this role",
    },
  ],
});

const mandarinAdvantage = (adId: string): AdRequirementsV1 => ({
  ...mandarinBlocking(adId),
  requirements: [
    {
      id: "mandarin-advantage",
      band: "nice-to-have",
      kind: "ordinary",
      requirement: "Mandarin an advantage",
      // #165: an ordinary requirement that NAMES a language now carries the dimension and subject
      // too (ad-reader.md's rule, independent of `kind`) — it still can never withdraw the job, but
      // it can now trigger the level question, which is where a "plus" actually pays off.
      eligibilityDimension: "language",
      eligibilitySubject: "Mandarin",
      sourceSpan: "Mandarin an advantage",
    },
  ],
});

const sessionId = async (app: ReturnType<typeof buildServer>["app"], cookie: string): Promise<string> => {
  const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
  return me.json().id as string;
};

// #308: the ladder's HTTP door (POST /onboarding/language-level) was deleted with the card ladder
// — owner decision, 2026-09-29. Tests place a rung through the ladder's own write function, the
// exact call the tailor queue's profile-answer route makes; the function still validates (a
// non-rung is refused), so nothing these tests prove got weaker.
const placeLevel = async (
  built: Pick<ReturnType<typeof buildServer>, "app" | "eligibility">,
  cookie: string,
  language: string,
  level: string,
) => answerLanguageLevel(built.eligibility, await sessionId(built.app, cookie), language, level);

// #123 — module-scoped (not local to one describe block) so both the "driven end to end" block and
// the withdrawn.total/byLanguage reporting block below can start discovery and find the languages
// question's itemId the same way, without each re-implementing the lookup.
const languageItemId = async (app: ReturnType<typeof buildServer>["app"], cookie: string): Promise<string> => {
  const start = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json() as {
    questions: Array<{ itemId: string; eligibility?: { dimension: string } }>;
  };
  return start.questions.find((q) => q.eligibility?.dimension === "language")!.itemId;
};

describe("#107 E5 slice 6 — withdrawal (AC1-AC3, AC5, AC6)", () => {
  it("AC1: a posting explicitly requiring fluent Mandarin does not appear for a user who explicitly said they don't speak it, whatever its score", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(target.id); // AC5: absence, through the API
  });

  it("AC2: 'Mandarin an advantage' (ordinary) still appears for the same user who said no to Mandarin", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinAdvantage(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  it("AC3: a posting explicitly requiring fluent Mandarin appears — the requirement open, not silently met — for a user never asked about Mandarin", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app } = buildServer({ readAd }); // no eligibility answer recorded at all — never asked

    const cookie = await anonSession(app);
    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const card = body.cards.find((c) => c.adId === target.id);
    expect(card).toBeDefined(); // appears
    expect(card!.dontYet.map((r) => r.id)).toContain("mandarin-required"); // open, not asserted met
  });

  // "conversational" ("Some, but not for work") is not "I don't speak it" — the spec's own second
  // regression case, at the boundary (withdrawal.test.ts also pins it as a direct unit).
  //
  // Code-review must-fix 1 (2026-08-04): #123's languages question is now a binary multi-select with
  // no option that WRITES "conversational" any more — no live path through the answer route reaches
  // this state today (see eligibilityDiscovery.ts's LANGUAGES_CONSEQUENCE doc and docs/research/
  // languages-from-the-corpus.md's "Decision taken" section for the recorded trade). This test seeds
  // the value directly at the store, not through the route, on purpose: it is NOT dead — it pins that
  // a fact stored under the pre-#123 three-option question (or any future surface that reintroduces
  // one) must still never withdraw. Kept live deliberately, annotated so it doesn't read as a stale
  // leftover of a removed feature.
  it("regression (legacy value, not reachable via the current UI): 'conversational', however stored, does not withdraw the posting", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      value: "conversational",
      label: "Professional fluency in Mandarin",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  // Regression from #86's own testing decisions: a `must`-band CAPABILITY requirement never
  // classifies blocking in the first place (adReader.ts's clampBlocking) — so an ordinary
  // requirement can never withdraw a posting, however explicitly it's answered.
  it("regression: an ordinary (non-blocking) requirement never withdraws a posting, however it's answered", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const ordinaryOnly = (adId: string): AdRequirementsV1 => ({
      ...mandarinBlocking(adId),
      requirements: [{ ...mandarinBlocking(adId).requirements[0]!, kind: "ordinary" }],
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? ordinaryOnly(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  // M1 (code review), resolved by #182: work-rights no longer withdraws BLINDLY — a fact with no
  // known market (this session never ran discovery, so it has no city at all) still must never
  // withdraw, exactly the spec's own named worst case (a winnable job silently vanishing) for a
  // session the engine cannot place. The market-AWARE cases (same-market withdraws, a DIFFERENT
  // market's answer has no effect) are pinned below, at this same API boundary, per #86's Testing
  // Decisions — the primary seam, not only a withdrawal.test.ts unit.
  it("a posting with a blocking work-rights requirement still appears for a user with no known market at all", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const workRightsBlocking = (adId: string): AdRequirementsV1 => ({
      schemaVersion: "1",
      adId,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        {
          id: "work-rights-required",
          band: "essential",
          kind: "blocking",
          requirement: "Right to work required, no visa sponsorship",
          eligibilityDimension: "work-rights",
          sourceSpan: "must already have the right to work without sponsorship",
        },
      ],
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? workRightsBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "work-rights",
      familyId: ANY_FAMILY,
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  // #182 QA round 2/3: gating reads the POSTING'S OWN market (its `location` field), never the
  // session's currently-typed city — a Hong Kong answer must never gate a Sydney posting, and a
  // posting genuinely IN the answered market must still be gated by it. Real fixture locations
  // (never a hand-picked market like "Paris", which this product's region map doesn't cover at all)
  // so the region-matching path — postingRetrieval.ts's regionsForLocationText — is really exercised.
  const workRightsBlocking = (adId: string): AdRequirementsV1 => ({
    schemaVersion: "1",
    adId,
    curated: false,
    language: "en",
    familyFit: { family: "IT Project Manager", confidence: 0.6 },
    requirements: [
      {
        id: "work-rights-required",
        band: "essential",
        kind: "blocking",
        requirement: "Right to work required, no visa sponsorship",
        eligibilityDimension: "work-rights",
        sourceSpan: "must already have the right to work without sponsorship",
      },
    ],
  });

  it("#182: a work-rights 'no' answered about a posting's OWN market (Hong Kong) withdraws it", async () => {
    const target = uncachedEnglishPostings().find((p) => /hong kong/i.test(p.location))!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? workRightsBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE }); // ROLE names Paris — irrelevant now
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "work-rights",
      familyId: "hong-kong",
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(target.id);
  });

  // #182 AC3, at the API boundary: a "no" planted for a DIFFERENT market than a posting's OWN one
  // must have no effect — the falsifiable check named on the ticket, and the exact QA repro (a Hong
  // Kong answer must never withdraw a Sydney posting).
  it("#182 AC3: a Hong Kong 'no' has no effect on a posting located in Sydney/Australia", async () => {
    const target = uncachedEnglishPostings().find((p) => /sydney|australia/i.test(p.location))!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? workRightsBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "work-rights",
      familyId: "hong-kong",
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id); // the Sydney posting is never gated by Hong Kong's answer
  });

  it("#182 AC3 (converse): a Sydney 'no' withdraws the Sydney posting the Hong Kong answer left standing", async () => {
    const target = uncachedEnglishPostings().find((p) => /sydney|australia/i.test(p.location))!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? workRightsBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "work-rights",
      familyId: "sydney",
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(target.id);
  });

  it("AC6: a withdrawal is observable — deck.cards_withdrawn rises by exactly one per withdrawn card", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    await warmRetrieval(app, cookie); // #63: settle retrieval outside the measured window
    const before = readCounters()["deck.cards_withdrawn"];
    await get(app, cookie, "/onboarding/cards");
    expect(readCounters()["deck.cards_withdrawn"]).toBe(before + 1);
  });

  it("a withdrawn card never triggers a paid judging call, even when a judge is wired — it must never cost a model call", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const judgedIds: string[] = [];
    const judge = async (adReq: AdRequirementsV1) => {
      judgedIds.push(adReq.adId);
      return null;
    };
    const { app, eligibility } = buildServer({ readAd, judge, judgeMaxCards: 999 });
    const cookie = await anonSession(app);
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(target.id);
    expect(judgedIds).not.toContain(target.id);
  });
});

// --- #123 — the languages question arms #107's engine with a REAL answer, not a seeded fact --------
// Every #107 test above seeds the Mandarin fact directly via eligibility.put() — that proves the
// withdrawal PREDICATE, but #123's whole point is the discovery question that actually WRITES that
// fact from a visitor's own tap. Every case below goes through the real
// /onboarding/discovery/start + /onboarding/discovery/answer routes, then GET /onboarding/cards —
// reusing #107's own mandarinBlocking/mandarinAdvantage fixtures rather than re-authoring them.
describe("#123 the languages question, driven end to end into #107's withdrawal engine", () => {
  // Take-it-or-leave-it (code review, 2026-08-04): gave this a real deck assertion rather than
  // dropping it — discovery.test.ts's own AC1 already pins the store-only shape, but a card deck
  // is exactly what proves recording TWO languages does something a single-language answer couldn't:
  // BOTH languages' blocking postings survive from the same one answer.
  it("AC1: a visitor can record more than one language in one answer — both languages' blocking postings survive in the deck", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const cantoneseBlocking = (adId: string): AdRequirementsV1 => ({
      ...mandarinBlocking(adId),
      requirements: [
        {
          id: "cantonese-required",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Cantonese required",
          eligibilityDimension: "language",
          eligibilitySubject: "Cantonese",
          sourceSpan: "Fluent Cantonese is required",
        },
      ],
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? cantoneseBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const itemId = await languageItemId(app, cookie);
    const sid = await sessionId(app, cookie);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Cantonese"] });

    expect(await eligibility.get(sid, "language", "English")).toMatchObject({ value: "declared" });
    expect(await eligibility.get(sid, "language", "Cantonese")).toMatchObject({ value: "declared" });
    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id); // the Cantonese-blocking posting survives
  });

  // 🚨 #165 AC2, end to end through the real routes, and the inversion of the #123 test that used to
  // stand here. Leaving Mandarin off the list USED to withdraw every Mandarin posting — a mistap cost
  // real jobs. It must now cost nothing at all: the posting stays, and the only route to a withdrawal
  // is the ladder's own bottom rung, tapped deliberately, which the second half of this test walks.
  it("#165 AC2: leaving Mandarin off the list withdraws NOTHING — only 'I don't speak this one' does", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);
    const itemId = await languageItemId(app, cookie);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English"] }); // Mandarin not listed

    const kept = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(kept.cards.map((c) => c.adId)).toContain(target.id);

    // The one deliberate answer that does withdraw it.
    const said = await placeLevel(built, cookie, "Mandarin", "not-at-all");
    expect(said).toEqual({ ok: true });
    const after = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(after.cards.map((c) => c.adId)).not.toContain(target.id);
  });

  // ADR-0003 clause 8(a) end to end: being BELOW an advert's bar never withdraws.
  it("#165 AC2: placing yourself on a low rung keeps the posting — below the bar is not a no", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);

    await placeLevel(built, cookie, "Mandarin", "gets-by");

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  it("AC3: the same visitor still sees a posting where Mandarin is only 'an advantage'", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinAdvantage(posting.id) : stubRequirements(posting.id);
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const itemId = await languageItemId(app, cookie);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English"] });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  it("AC4: a visitor who has not yet answered the languages question loses nothing on a language ground", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app } = buildServer({ readAd }); // discovery never started — the languages question never answered

    const cookie = await anonSession(app);
    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });

  it("AC6: correcting a 'I don't speak this one' to a real rung brings the withdrawn posting back", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);

    await placeLevel(built, cookie, "Mandarin", "not-at-all");
    const withdrawn = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(withdrawn.cards.map((c) => c.adId)).not.toContain(target.id);

    await placeLevel(built, cookie, "Mandarin", "gets-by");
    const corrected = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(corrected.cards.map((c) => c.adId)).toContain(target.id);
  });

  // Owner requirement (mid-build): the language list must be safe to grow (e.g. adding Laos later)
  // without hurting a visitor who already answered under a shorter list. A requirement naming a
  // language outside today's supported set has no fact to match against — unknown, never a "no" —
  // exactly the same never-withdraws guarantee withdrawal.ts already gives any never-asked scope.
  it("growing the language list later stays safe: a language outside today's list never withdraws, even after a real answer", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const laoBlocking = (adId: string): AdRequirementsV1 => ({
      ...mandarinBlocking(adId),
      requirements: [
        {
          id: "lao-required",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Lao required",
          eligibilityDimension: "language",
          eligibilitySubject: "Lao", // not in today's supported list (apps/api/data/languages-by-market.json)
          sourceSpan: "Fluent Lao is required",
        },
      ],
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? laoBlocking(posting.id) : stubRequirements(posting.id);
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const itemId = await languageItemId(app, cookie);
    // A visitor who answered EVERY language in today's list — the fullest possible real answer
    // before Lao is ever a supported market.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId,
      answers: ["English", "Mandarin", "Cantonese", "Vietnamese"],
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).toContain(target.id);
  });
});

interface WithdrawnSummary {
  total: number;
  byLanguage: Array<{ language: string; count: number }>;
}

// Coordinator request (2026-08-04): the reveal's undo line ("N jobs needed Mandarin — I left them
// out") needs the server to REPORT what it silently dropped — a withdrawn posting was previously
// just absent from `cards`, with no trace in the response body (deck.cards_withdrawn is a
// process-wide operator counter, not part of this response). Tallied inside the SAME filter that
// already decides openCandidates (routes/onboarding.ts) — no second pass, no second eligibility
// read, and withdrawal.ts's own predicate is unchanged.
describe("#123 GET /onboarding/cards reports withdrawn.total/byLanguage for the reveal's undo line", () => {
  it("Mandarin causing exactly one removal is reported with the visitor's own tick-box casing", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);
    await placeLevel(built, cookie, "Mandarin", "not-at-all");

    const body = (await get(app, cookie, "/onboarding/cards")).json() as {
      cards: JobCard[];
      withdrawn: WithdrawnSummary;
    };
    expect(body.cards.map((c) => c.adId)).not.toContain(target.id); // the posting really is missing
    expect(body.withdrawn).toEqual({ total: 1, byLanguage: [{ language: "Mandarin", count: 1 }] });
  });

  it("two different languages each removing one posting are both reported, sorted by count then name", async () => {
    const [mandarinTarget, cantoneseTarget] = uncachedEnglishPostings();
    const cantoneseBlocking = (adId: string): AdRequirementsV1 => ({
      ...mandarinBlocking(adId),
      requirements: [
        {
          id: "cantonese-required",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Cantonese required",
          eligibilityDimension: "language",
          eligibilitySubject: "Cantonese",
          sourceSpan: "Fluent Cantonese is required",
        },
      ],
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      if (posting.id === mandarinTarget!.id) return mandarinBlocking(posting.id);
      if (posting.id === cantoneseTarget!.id) return cantoneseBlocking(posting.id);
      return stubRequirements(posting.id);
    };
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);
    await placeLevel(built, cookie, "Mandarin", "not-at-all");
    await placeLevel(built, cookie, "Cantonese", "not-at-all");

    const body = (await get(app, cookie, "/onboarding/cards")).json() as {
      cards: JobCard[];
      withdrawn: WithdrawnSummary;
    };
    expect(body.cards.map((c) => c.adId)).not.toContain(mandarinTarget!.id);
    expect(body.cards.map((c) => c.adId)).not.toContain(cantoneseTarget!.id);
    expect(body.withdrawn).toEqual({
      total: 2,
      byLanguage: [
        { language: "Cantonese", count: 1 }, // tied at count 1 — name ascending breaks the tie
        { language: "Mandarin", count: 1 },
      ],
    });
  });

  it("nothing withdrawn reports an explicit empty summary, not an omitted field", async () => {
    const { app } = buildServer(); // no readAd override — every posting keeps its ordinary fixture
    const cookie = await anonSession(app);
    const itemId = await languageItemId(app, cookie);
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId,
      answers: ["English", "Mandarin", "Cantonese", "Vietnamese"], // every language listed
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { withdrawn: WithdrawnSummary };
    expect(body.withdrawn).toEqual({ total: 0, byLanguage: [] });
  });

  // The trap the coordinator named explicitly: a posting excluded for a DIFFERENT reason (here, a
  // failed advert read) must never be counted as a language withdrawal — the number must mean "cost
  // you a job", not "absent from the deck for any reason at all while a language answer existed".
  it("a posting excluded for an unrelated reason (a failed advert read) is never counted as a language withdrawal", async () => {
    const [failedTarget, mandarinTarget] = uncachedEnglishPostings();
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      if (posting.id === failedTarget!.id) return null; // unreadable advert — excluded for another reason
      if (posting.id === mandarinTarget!.id) return mandarinBlocking(posting.id);
      return stubRequirements(posting.id);
    };
    const built = buildServer({ readAd });
    const { app } = built;
    const cookie = await anonSession(app);
    await placeLevel(built, cookie, "Mandarin", "not-at-all");

    const body = (await get(app, cookie, "/onboarding/cards")).json() as {
      cards: JobCard[];
      withdrawn: WithdrawnSummary;
    };
    expect(body.cards.map((c) => c.adId)).not.toContain(failedTarget!.id);
    expect(body.cards.map((c) => c.adId)).not.toContain(mandarinTarget!.id);
    // Only the Mandarin posting counts — the unreadable one was never a candidate to begin with.
    expect(body.withdrawn).toEqual({ total: 1, byLanguage: [{ language: "Mandarin", count: 1 }] });
  });
});

// #308 — the ladder is RETIRED off the deck card into the Tailor queue (tailorProfile.test.ts
// carries the queue-side coverage). The deck payload no longer asks anything: a card whose advert
// tests a language carries no levelAsk, same as every other card. The ladder's old HTTP door is
// deleted too (owner decision, 2026-09-29); its write function's own refusals are pinned in
// languageLevel.test.ts.
describe("#308 the deck card no longer asks the language ladder", () => {
  type CardWithAsk = JobCard & { levelAsk?: unknown };
  const cardsOf = async (app: Parameters<typeof get>[0], cookie: string) =>
    ((await get(app, cookie, "/onboarding/cards")).json() as { cards: CardWithAsk[] }).cards;

  it("no card carries a levelAsk, even the one whose advert tests Mandarin", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);

    const cards = await cardsOf(app, cookie);
    expect(cards.map((c) => c.adId)).toContain(target.id); // the posting is there — it just no longer asks
    expect(cards.every((c) => c.levelAsk === undefined)).toBe(true);
  });

});

// #107 (E5 slice 6, D4) — withdrawal holds on every surface that renders an advert, not only the deck.
describe("#107 D4 — withdrawal on every surface that renders an advert", () => {
  it("a withdrawn ad is not a valid /want target — same 404 shape as an unknown card", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await signIn(app, cookie, "withdrawn-want@example.com");
    const sid = await sessionId(app, cookie);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });

    const res = await post(app, cookie, `/onboarding/cards/${target.id}/want`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "unknown card" } });
  });

  // code-review M3: a PERSISTED tailor target that becomes withdrawn must be SILENT — no rejection
  // message, no error screen (the ticket's own UX intent) — and must not keep repeating on reload, so
  // the target is cleared. "Behaves exactly like no target at all" means the SAME response GET/POST
  // already give when session.tailorAdId is null: 409 no_tailor_target, never a 404.
  it("a withdrawn tailor target behaves exactly like no target at all — cleared, not a rejection (M3)", async () => {
    const target = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === target.id ? mandarinBlocking(posting.id) : stubRequirements(posting.id);
    const { app, sessions, eligibility } = buildServer({ readAd });
    const cookie = await anonSession(app);
    await signIn(app, cookie, "withdrawn-tailor@example.com");
    const sid = await sessionId(app, cookie);
    // tailorAdId is persisted session state that can predate a withdrawal (e.g. wanted, then the
    // Mandarin answer landed later) — set directly, exercising this gate on its own terms rather than
    // relying on /want's earlier (still-404) check to have kept this state from ever existing.
    await warmRetrieval(app, cookie); // #63: the target advert arrives through retrieval
    await sessions.setTailorTarget(sid, target.id);
    await eligibility.put(sid, {
      dimension: "language",
      familyId: "Mandarin",
      // #165: the language "no" is the ladder's bottom rung now — a value only a deliberate tap
      // produces. The pre-#165 "none" (written for every UNTICKED box) no longer withdraws anything.
      value: "not-at-all",
      label: "Mandarin — I don't speak this one",
    });
    const noTargetShape = { error: { code: "no_tailor_target", message: "no job being tailored" } };

    const getRes = await get(app, cookie, "/onboarding/tailor");
    expect(getRes.statusCode).toBe(409);
    expect(getRes.json()).toEqual(noTargetShape);
    // Cleared, not just silenced for this one response — a reload must not keep landing on it.
    const meAfterGet = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(meAfterGet.json().tailorAdId).toBeNull();

    await sessions.setTailorTarget(sid, target.id); // re-persist to prove POST clears it independently
    const answerRes = await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: "mandarin-required",
      answer: "Yes",
    });
    expect(answerRes.statusCode).toBe(409);
    expect(answerRes.json()).toEqual(noTargetShape);
    const meAfterPost = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(meAfterPost.json().tailorAdId).toBeNull();
  });
});

// #107 (E5 slice 6, D5) — a years-experience shortfall counts, proportionately, on the JUDGED path.
describe("#107 D5 — the years shortfall (AC4)", () => {
  it("AC4: 5 years against an 8+ bar scores lower than 9 years would — neither zero nor identical, and the job stays either way", async () => {
    const fakeJudge = async (adReq: AdRequirementsV1) => ({
      verdicts: adReq.requirements.map((r) => ({
        requirementId: r.id,
        fit: 1,
        supportingFactId: null,
        reason: "fake — every requirement fully met except the years bar, which #107 replaces",
      })),
      version: "test",
      cost: { model: "fake", inputTokens: 0, outputTokens: 0, judgedAt: new Date().toISOString() },
      facts: [],
    });

    const scoreFor = async (years: string): Promise<number> => {
      const { app, eligibility } = buildServer({ judge: fakeJudge, judgeMaxCards: 999 });
      const cookie = await anonSession(app);
      await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
      const sid = await sessionId(app, cookie);
      // #162: the total is WORKED OUT and stored at the global scope (yearsWorked.ts) — never asked,
      // and no longer family-scoped. Seeded directly here, standing in for a dated work history.
      await eligibility.put(sid, {
        dimension: "years-experience",
        familyId: ANY_FAMILY,
        value: years,
        label: "Years of experience (worked out from your dated jobs)",
      });

      const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
      const card = body.cards.find((c) => c.adId === VALID_AD_ID)!;
      expect(card.scored).toBe("judged"); // proves this ran the JUDGED path, not the deterministic one
      return card.matchPct;
    };

    const five = await scoreFor("5");
    const nine = await scoreFor("9");
    expect(five).toBeGreaterThan(0);
    expect(nine).toBeGreaterThan(0);
    expect(five).not.toBe(nine);
    expect(five).toBeLessThan(nine);
  });
});

// #235 — the empty deck's own question: is another discovery question genuinely still open? The
// deck's "answer a few more questions and I'll widen the net" line may only be shown when one is.
describe("#235 hasOpenDiscoveryQuestions", () => {
  const ROLE = "IT project manager";
  const session = (
    over: Partial<Parameters<typeof hasOpenDiscoveryQuestions>[0]> = {},
  ): Parameters<typeof hasOpenDiscoveryQuestions>[0] => ({
    targetTitles: [ROLE],
    intent: { targetRole: ROLE, searchAreas: [] },
    discovery: {
      questionFloors: [],
      searchFamily: null,
      coveredItemIds: [],
      checkpoint: null,
      fallback: { declined: false, family: null },
    },
    ...over,
  });
  const answered = (itemId: string): ClaimRecord => ({
    id: discoveryClaimId(itemId),
    role: "profile",
    text: `${itemId} answered`,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: "answer",
    needs_grill: false,
    grill_hint: null,
    decision: "confirmed",
    origin: "user-authored",
  });

  it("an uncovered production question floor is an open question", () => {
    expect(
      hasOpenDiscoveryQuestions(
        session({
          discovery: {
            questionFloors: [{ familyId: "it-project-delivery", version: 1 }],
            searchFamily: null,
            coveredItemIds: [],
            fallback: { declined: false, family: null },
            checkpoint: "family_confirmed",
          },
        }),
        [], [], [], [], [], DISCOVERY_FAMILY,
      ),
    ).toBe(true);
  });

  it("a fresh role still has its floor and eligibility questions open", () => {
    expect(hasOpenDiscoveryQuestions(session(), [], [], [], [], [], DISCOVERY_FAMILY)).toBe(true);
  });

  it("no role means question 1 itself is open", () => {
    expect(
      hasOpenDiscoveryQuestions(
        session({ targetTitles: [], intent: { targetRole: null, searchAreas: [] } }),
        [], [], [], [], [], DISCOVERY_FAMILY,
      ),
    ).toBe(true);
  });

  it("with every floor item answered and eligibility closed, nothing is open", () => {
    const items = DISCOVERY_FAMILY.items;
    const confirmed = items.map((item) => answered(item.id));
    const facts: EligibilityFact[] = [
      { dimension: "work-rights", familyId: ANY_FAMILY, value: "yes", label: "Right to work" },
      { dimension: "language", familyId: ANY_FAMILY, value: "English", label: "Languages" },
    ];
    expect(hasOpenDiscoveryQuestions(session(), confirmed, [], [], facts, [], DISCOVERY_FAMILY)).toBe(false);
  });

  it("a floorless plan with eligibility closed has no phantom questions open", () => {
    const facts: EligibilityFact[] = [
      { dimension: "work-rights", familyId: ANY_FAMILY, value: "yes", label: "Right to work" },
      { dimension: "language", familyId: ANY_FAMILY, value: "English", label: "Languages" },
    ];
    expect(hasOpenDiscoveryQuestions(session(), [], [], [], facts, [], null)).toBe(false);
  });
});

// #229 — the career changer is scored honestly AND told: the deck response carries newToFamily when
// this deck's family is a KNOWN zero for her while her CV holds years elsewhere. Copy only — the
// rule the ticket must not break is that the score stays generous and the words carry the truth,
// so the flag never touches a card's number (nothing here asserts a changed score, deliberately).
describe("#229 newToFamily — the change-of-direction signal", () => {
  const years = (over: Partial<SessionYears>): SessionYears => ({
    total: 9,
    family: 0,
    familySource: "zero",
    familyConfidence: null,
    ...over,
  });

  it("fires only on a known zero with years elsewhere", () => {
    expect(newToFamily(years({}))).toBe(true);
    // A per-family FACT (even a low one) is not a change of direction — she is in this work.
    expect(newToFamily(years({ family: 2, familySource: "fact" }))).toBe(false);
    // Unaccounted years are an UNKNOWN, never called a change of direction (the ticket's own
    // boundary: only #222's known-zero rule makes this detectable at all).
    expect(newToFamily(years({ family: 9, familySource: "fallback" }))).toBe(false);
    expect(newToFamily(years({ family: 9, familySource: "unscoped" }))).toBe(false);
    // Zero years everywhere is a first job, not a change of direction.
    expect(newToFamily(years({ total: 0, family: 0 }))).toBe(false);
  });

  it("GET /onboarding/cards says newToFamily for a career changer, and stops once her years are in this family", async () => {
    const changer = buildItProjectDeliveryServer();
    const cookie = await anonSession(changer.app);
    await post(changer.app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const sid = await sessionId(changer.app, cookie);
    // #162: a career total worked out from dated jobs, none of them in the deck's family — with
    // every counting job placed (none here at all), that family reads as a KNOWN zero.
    await changer.eligibility.put(sid, {
      dimension: "years-experience",
      familyId: ANY_FAMILY,
      value: "9",
      label: "Years of experience (worked out from your dated jobs)",
    });
    expect((await get(changer.app, cookie, "/onboarding/cards")).json().newToFamily).toBe(true);

    // The same visitor WITH a years fact in the deck's family: not new to it, nothing said.
    await changer.eligibility.put(sid, {
      dimension: "years-experience",
      familyId: "it-project-delivery",
      value: "9",
      label: "Years in IT project delivery",
    });
    expect((await get(changer.app, cookie, "/onboarding/cards")).json().newToFamily).toBe(false);
  });
});
