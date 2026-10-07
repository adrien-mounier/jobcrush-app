// #63 — "server-owned credible match reveal": the reveal counts LIVE retrieved adverts, or it does
// not happen. Driven through the pinned HTTP seam (GET /onboarding/cards), because the whole defect
// this ticket closes lived in the gap between what the retrieval STATUS said and what the CARDS did:
// the status refused honestly while the deck below it served 17 hand-maintained fixtures and the
// screen revealed "17 jobs just matched you" on top of them.
//
// The ticket's own context sentence is the specification these tests exist to enforce: *fixtures,
// provisional floors, unresolved placement, incomplete floors, and invented requirements can never
// authorize reveal.*
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { loadPostings } from "../src/preview.js";
import { buildItProjectDeliveryServer } from "./placedServer.js";
import {
  buildDeckServer,
  discoveryFact,
  fixtureRetriever,
  getCardsWhenRetrieved,
  injectSettled,
} from "./fixtureDeck.js";

type App = ReturnType<typeof buildServer>["app"];

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const deck = async (app: App, cookie: string) =>
  (await getCardsWhenRetrieved(app, cookie)).json() as {
    cards: Array<{ adId: string }>;
    retrieval: { outcome: string; code?: string };
    searching?: boolean;
    moreQuestions?: boolean;
  };

describe("#63 fixtures can never authorize a reveal", () => {
  // THE regression guard for this whole ticket. A server with no posting provider wired is exactly
  // production without a provider key — and before #63 that server happily revealed the 17 adverts
  // in data/sample-postings.json to every visitor, having retrieved nothing at all. There is no
  // configuration, and no client, that can reach a card without a retrieval result any more.
  it("serves NO cards when nothing was retrieved, however many adverts sit in the pool", async () => {
    expect(loadPostings().length).toBeGreaterThan(0); // the pool is genuinely non-empty...
    const { app } = buildServer(); // ...and no provider is wired, exactly like a keyless deploy
    const cookie = await anonSession(app);
    const body = await deck(app, cookie);
    expect(body.cards).toEqual([]);
    // and it says so as an outage, never as a statement about her market
    expect(body.retrieval.outcome).toBe("provider_unavailable");
  });

  // AC1: gates passed and relevant postings retrieved -> the count may be revealed, and it counts
  // the RETRIEVED adverts. Every card's id is a retrieved posting id (`posting:<canonicalKey>`),
  // which is the mechanical proof that no fixture row snuck into the number.
  //
  // This is the WORD-SEARCH path (no search family, no pinned floor), whose gate #235 decided is
  // open by definition — an empty floor list is covered, and her typed words are the query. It is
  // deliberately the weakest gate in the product, which makes it the sharpest test of this ticket:
  // even where nothing has to be earned, a card still cannot exist without a retrieval result. The
  // family path is the next test down.
  it("reveals a count built only from retrieved adverts once retrieval succeeds", async () => {
    const { app } = buildDeckServer();
    const cookie = await anonSession(app);
    const body = await deck(app, cookie);
    expect(body.retrieval.outcome).toBe("relevant_postings");
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards.every((card) => card.adId.startsWith("posting:"))).toBe(true);
  });

  // AC2: the gate is the SERVER's. #339 removed the essential-floor gate this test used to refuse on
  // (discovery no longer asks the floor, so nothing could cover it): a family-path session with
  // nothing answered past question 1 is revealed retrieved adverts, never `floor_not_covered`. The
  // gate that remains — #338's completed review — is driven over HTTP in cvReview.test.ts.
  it("reveals a family-path deck with no floor answered — the floor gates nothing any more", async () => {
    const { app } = buildItProjectDeliveryServer({ retrievePostings: fixtureRetriever() });
    const cookie = await anonSession(app);
    await app.inject({
      method: "POST",
      url: "/onboarding/discovery/start",
      headers: { cookie },
      payload: { role: "IT project manager in Hong Kong" },
    });

    const earned = await deck(app, cookie);
    expect(earned.retrieval.outcome).toBe("relevant_postings");
    expect(earned.cards.length).toBeGreaterThan(0);
    expect(earned.cards.every((card) => card.adId.startsWith("posting:"))).toBe(true);
  });

  // AC3: a search that finished and found nothing is a real, honest zero — no cards, and no reward
  // built out of the fixture pool to paper over it. The adjustment route stays open.
  it("shows no reward at all for an empty pool, and keeps a way to adjust", async () => {
    const { app } = buildDeckServer({ retrievePostings: fixtureRetriever([]) });
    const cookie = await anonSession(app);
    const body = await deck(app, cookie);
    expect(body.retrieval.outcome).toBe("empty_pool");
    expect(body.cards).toEqual([]);
    expect(body.moreQuestions).toBe(true); // adjustment is offered, not a dead end
  });

  // The distinction #174 handed this ticket, kept where the screen can act on it: "we asked and
  // there was nothing" and "we could not ask" must never arrive as the same payload. Every market
  // runs on a single provider, so collapsing these would tell someone their whole market is empty
  // on the strength of one supplier being offline.
  it("reports an outage as an outage, never as an empty pool", async () => {
    const { app } = buildDeckServer({
      retrievePostings: async () => ({
        schemaVersion: "5",
        outcome: "provider_unavailable",
        coverage: { providersQueried: [], providersUnavailable: ["techmap"], complete: false },
        reason: "provider is down",
        retryable: true,
      }),
    });
    const cookie = await anonSession(app);
    const body = await deck(app, cookie);
    expect(body.retrieval.outcome).toBe("provider_unavailable");
    expect(body.retrieval.outcome).not.toBe("empty_pool");
    expect(body.cards).toEqual([]);
    expect(body.searching).toBe(false); // a finished failure, not #245's still-looking wait state
  });

  // AC4: adjusting her intent re-runs retrieval WITHOUT costing her the discovery she has already
  // done. Only the dependent result — the deck — invalidates.
  it("keeps evidence and discovery when intent changes; only the deck re-runs", async () => {
    let calls = 0;
    const { app, claims } = buildItProjectDeliveryServer({
      retrievePostings: async (...args) => {
        calls += 1;
        return fixtureRetriever()(...(args as []));
      },
    });
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const sessionId = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((c) => c.name === "jc_session")!.value}`;
    await app.inject({
      method: "POST",
      url: "/onboarding/discovery/start",
      headers: { cookie },
      payload: { role: "IT project manager in Hong Kong" },
    });
    // #339: discovery no longer asks for these, so plant one answer of each kind straight into the
    // store — the facts the intent change below must not throw away.
    await claims.add(sessionId, discoveryFact("end-to-end-delivery", "Led delivery end to end."));
    await claims.answerNegative(sessionId, discoveryFact("delivery-communication", "No"));
    expect((await deck(app, cookie)).cards.length).toBeGreaterThan(0);
    const callsAfterFirstDeck = calls;
    const coveredBefore = (
      await injectSettled(app, { method: "GET", url: "/onboarding/discovery", headers: { cookie } })
    ).json();
    expect(coveredBefore.factCount).toBeGreaterThanOrEqual(2);

    // She changes where she is looking. That is a different search.
    const changed = await injectSettled(app, {
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { searchAreas: ["Singapore"] },
    });
    expect(changed.statusCode).toBe(200);

    const after = await deck(app, cookie);
    expect(calls).toBeGreaterThan(callsAfterFirstDeck); // the deck was re-retrieved...
    expect(after.cards.length).toBeGreaterThan(0);
    // ...and nothing she answered was thrown away with it.
    const coveredAfter = (
      await injectSettled(app, { method: "GET", url: "/onboarding/discovery", headers: { cookie } })
    ).json();
    expect(coveredAfter.factCount).toBe(coveredBefore.factCount);
  });
});
