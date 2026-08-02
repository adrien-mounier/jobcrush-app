// #19 the reveal + the job card (screen 2a) — the pinned HTTP seam: GET /onboarding/cards over a
// real request, driven through the real discovery flow (prior art: discovery.test.ts). Asserts
// the response the frontend is pinned against, not handler internals: card shape, score-sorted
// order, and that a recorded "no" lands in askedClosed (never re-asked, never a gap).
import { describe, expect, it } from "vitest";
import { orderCardsForReveal } from "../src/routes/onboarding.js";
import { buildServer } from "../src/server.js";
import { listAdRequirements } from "../src/e5stub.js";

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
    const ordered = orderCardsForReveal([
      { card: { adId: "curated-low", matchPct: 70 }, curated: true },
      { card: { adId: "wide-best", matchPct: 99 }, curated: false },
      { card: { adId: "curated-high", matchPct: 80 }, curated: true },
      { card: { adId: "wide-second", matchPct: 90 }, curated: false },
    ]);
    expect(ordered.map((card) => card.adId)).toEqual([
      "curated-high",
      "wide-best",
      "wide-second",
      "curated-low",
    ]);
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
    const allRequirements = listAdRequirements();
    expect(body.cards.map((card) => card.adId).sort()).toEqual(
      allRequirements.map((ad) => ad.adId).sort(),
    ); // every requirement set resolves to a real posting and reaches the HTTP deck
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
    expect(body.stage).toBe("deck"); // essential band fully asked

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
