// #19 the reveal + the job card (screen 2a) — the pinned HTTP seam: GET /onboarding/cards over a
// real request, driven through the real discovery flow (prior art: discovery.test.ts). Asserts
// the response the frontend is pinned against, not handler internals: card shape, score-sorted
// order, and that a recorded "no" lands in askedClosed (never re-asked, never a gap).
import { describe, expect, it, vi } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { orderCardsForReveal, withReadTimeout, mapWithConcurrency } from "../src/routes/onboarding.js";
import { buildServer } from "../src/server.js";
import { listAdRequirements, loadAdRequirements } from "../src/e5stub.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { languageEligible } from "../src/language.js";
import { makeAdReader } from "../src/adReader.js";
import { InMemoryAdRequirementsStore } from "../src/adRequirementsStore.js";
import { readCounters } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  url: string,
  payload?: unknown,
) => app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";

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
    const allPostings = loadPostings();
    const readerLangs = ["en"]; // readingLanguages()'s default for this anonymous session
    const allRequirements = listAdRequirements().filter((ad) => {
      const posting = allPostings.find((p) => p.id === ad.adId);
      return (
        !!posting &&
        languageEligible(posting.language, readerLangs) &&
        languageEligible(ad.language, readerLangs)
      );
    });
    expect(body.cards.map((card) => card.adId).sort()).toEqual(
      allRequirements.map((ad) => ad.adId).sort(),
    ); // every ENGLISH requirement set resolves to a real posting and reaches the HTTP deck
    expect(body.cards[1]).toBeDefined(); // passing the reveal card cannot exhaust the deck
    const curatedIds = new Set(
      allRequirements
        .filter((ad) => ad.curated)
        .map((ad) => ad.adId),
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
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    // Two essential "yes" answers → confirmed facts (fit); one essential "no" → a negative
    // (askedClosed). This also closes the essential band, flipping the session to "deck" (#18).
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "budget-accountability",
      answer: "Yes, over $1M",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, multiple teams",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "stakeholder-reporting",
      answer: "No",
    });

    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stage: string; cards: JobCard[] };
    // #106: stage no longer flips to deck on the essential band alone — three eligibility questions
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
    expect(fitIds).toContain("discovery-budget-accountability");
    expect(fitIds).toContain("discovery-cross-functional-leadership");

    // The recorded "no" shows up in askedClosed on every card — a closed question, not a gap:
    // it's never confirmed (fit) and it's not what dontYet renders (dontYet is the AD's own
    // requirements, not discovery items).
    for (const card of body.cards) {
      expect(card.askedClosed.map((f) => f.id)).toContain("discovery-stakeholder-reporting");
      expect(card.fit.map((f) => f.id)).not.toContain("discovery-stakeholder-reporting");
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
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "budget-accountability",
      answer: "Yes, over $1M",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, multiple teams",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "stakeholder-reporting",
      answer: "No",
    });
    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const byAdId = Object.fromEntries(
      body.cards.map((c) => [c.adId, { matchPct: c.matchPct, breakdown: c.breakdown }]),
    );
    expect(byAdId).toEqual({
      "2026-06-30_schneider-electric_senior-project-manager": {
        matchPct: 54,
        breakdown: { essential: { met: 1, total: 3 }, desirable: { met: 1, total: 4 } },
      },
      "2026-07-01_transunion_senior-project-manager-6-months-contract": {
        matchPct: 35,
        breakdown: { essential: { met: 0, total: 4 }, desirable: { met: 0, total: 4 } },
      },
      "2026-07-05_computershare-hong-kong_business-readiness-senior-project-manager-9-month-contract": {
        matchPct: 42,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 1, total: 5 } },
      },
      "2026-07-05_endava-vietnam_senior-project-manager": {
        matchPct: 29,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 4 } },
      },
      "2026-07-05_hire-feed_project-manager-remote": {
        matchPct: 49,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 4 } },
      },
      "2026-07-05_manulife_senior-it-project-manager-delivery-manager": {
        matchPct: 33,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      "2026-07-05_synpulse_business-analyst-project-manager-wealth-management-data": {
        matchPct: 26,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 5 } },
      },
      "2026-07-09_luvo-talent_senior-project-manager": {
        matchPct: 26,
        breakdown: { essential: { met: 0, total: 3 }, desirable: { met: 0, total: 4 } },
      },
    });
  });

  // #29: a requirement declined while tailoring an ad must be asked-and-closed on that ad's DECK card
  // too — spec #37, "the list of open things only ever shrinks". #23 filtered negatives in the tailor
  // assembly only, deliberately, so #19's deck payload stayed byte-identical while it shipped.
  it("a requirement answered 'no' in Tailor leaves that ad's deck card gaps, and only that ad's", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    for (const itemId of ["budget-accountability", "cross-functional-leadership", "stakeholder-reporting"]) {
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
    // askedClosed is session-wide, not ad-scoped: every recorded "no" lands on every card, exactly as
    // it already did for discovery negatives (#19). Unchanged by #29 — pinned so it stays deliberate.
    expect(otherAfter.askedClosed.length).toBe(otherBefore.askedClosed.length + 1);
  });

  // #103 (E5 slice 2): the AC this whole ticket hinges on, proven at the HTTP seam rather than by
  // inspection — a non-English posting (with a requirement set that WOULD join into a card without
  // the language gate, same as any English one) is retained and labelled in the pool, and never
  // reaches the deck for a default English-only session.
  it("retains a non-English posting in the pool, labelled, and never surfaces it as a card", async () => {
    const zh = loadPostings().find((p) => p.id === "2026-07-10_huaxin-tech-shenzhen_it-xiangmu-jingli");
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
    const posting = loadPostings().find((p) => p.id === adId);
    expect(posting!.language).toBe("en"); // the posting itself passes the posting-language gate

    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(adId); // still held back on the ad's own language
  });
});

describe("#21 POST /onboarding/cards/:adId/want", () => {
  it("sets the signed-in session to tailor for the selected card and persists it on /sessions/me", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "want-success@example.com");

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
  loadPostings()
    .filter((p) => p.language === "en")
    .filter((p) => {
      try {
        loadAdRequirements(p.id);
        return false;
      } catch {
        return true;
      }
    });

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
    const expectedIds = loadPostings()
      .filter((p) => p.language === "en")
      .filter((p) => {
        try {
          return languageEligible(loadAdRequirements(p.id).language, ["en"]);
        } catch {
          return true; // no fixture -> the fake reader supplies a valid English entry
        }
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
    const { app } = buildServer({ readAd: makeAdReader(llm, store, ["IT Project Manager"]) });

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
    const { app } = buildServer({ readAd: makeAdReader(llm, store, ["IT Project Manager"]) });
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

  it("the deck responds without the slow card, does not miscount it as a read failure, counts and alarms it as a timeout separately, still persists the paid-for read, exposes the reason (gated) over HTTP, and later serves it from cache with no second model call", async () => {
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
    };
    const { app } = buildServer({ readAd: makeAdReader(llm, store, ["IT Project Manager"]) });
    const cookie = await anonSession(app);

    let res!: Awaited<ReturnType<typeof get>>;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const resPromise = get(app, cookie, "/onboarding/cards");
      await vi.advanceTimersByTimeAsync(15_000); // the real READ_TIMEOUT_MS, simulated rather than waited
      res = await resPromise;
    } finally {
      vi.useRealTimers(); // always restore, even if an assertion above throws mid-block
    }

    expect(res.statusCode).toBe(200); // no 500 — the slow advert is dropped, not fatal
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(uncached.id);

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
      const body2 = res2.json() as { cards: JobCard[] };
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
    const before = {
      failed: readCounters()["postings.read_failed"],
      timedOut: readCounters()["postings.read_timed_out"],
    };
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200); // no 500
    const body = res.json() as { cards: JobCard[] };
    expect(body.cards.map((c) => c.adId)).not.toContain(uncached.id);

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
