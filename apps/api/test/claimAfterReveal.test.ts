// #64 — "claim the anonymous onboarding after the earned match reveal". The reveal is the moment a
// visitor has actually earned something, and it is also the moment we ask her to sign in. This file
// pins the two halves of that bargain on the server: what she keeps (nothing is re-earned, nothing
// is re-bought), and what she cannot reach until she signs in.
//
// Driven end to end through the HTTP seam on the #63 deck — a session that has genuinely earned a
// reveal off retrieved adverts, not a hand-built row — because "transfers without replay" is a
// claim about the whole flow, not about one store's update statement.
import { describe, expect, it } from "vitest";
import { buildItProjectDeliveryServer } from "./placedServer.js";
import { discoveryFact, fixtureRetriever, getCardsWhenRetrieved } from "./fixtureDeck.js";

type Built = ReturnType<typeof buildItProjectDeliveryServer>;
type App = Built["app"];

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const deck = async (app: App, cookie: string) =>
  (await getCardsWhenRetrieved(app, cookie)).json() as {
    cards: Array<{ adId: string; matchPct: number | null }>;
    authed: boolean;
  };

/** A visitor at the reveal, exactly as she arrives there: an upload of her own, a typed intent,
 *  answers with one explicit "no" among them, and a deck of retrieved adverts.
 *  `retrievals` counts every trip to the provider seam — the replay detector. */
async function visitorAtTheReveal() {
  const retrieve = fixtureRetriever();
  let retrievals = 0;
  const built = buildItProjectDeliveryServer({
    retrievePostings: async () => {
      retrievals += 1;
      return retrieve();
    },
  });
  const { app } = built;
  const cookie = await anonSession(app);

  const upload = await app.inject({
    method: "POST",
    url: "/uploads",
    headers: { cookie },
    payload: { filename: "cv.pdf" },
  });
  expect(upload.statusCode).toBe(201);

  await app.inject({
    method: "POST",
    url: "/onboarding/discovery/start",
    headers: { cookie },
    payload: { role: "IT project manager in Hong Kong" },
  });
  // One "no" among the answers: an explicit negative is a fact she gave us like any other, and it is
  // named in AC2's list of what must survive the claim. #339: discovery no longer asks the floor, so
  // her answers are planted straight into the claims store — and no floor stands between her and
  // the deck any more.
  const sessionId = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id;
  await built.claims.add(sessionId, discoveryFact("end-to-end-delivery", "Led delivery end to end."));
  await built.claims.answerNegative(sessionId, discoveryFact("delivery-communication", "No"));

  const earned = await deck(app, cookie);
  expect(earned.cards.length).toBeGreaterThan(0);
  expect(earned.authed).toBe(false);

  return { built, app, cookie, earned, uploadId: upload.json().id as string, retrievals: () => retrievals };
}

/** Everything AC2 names, read back through the seams that own it. */
async function keptState(built: Built, app: App, cookie: string) {
  const me = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json();
  const [confirmed, negatives] = await Promise.all([
    built.claims.confirmed(me.id),
    built.claims.negatives(me.id),
  ]);
  const stored = (await built.sessions.getById(me.id))!;
  return {
    sessionId: me.id,
    intent: me.intent,
    discovery: me.discovery, // carries the question floors — family id AND version — and the checkpoint
    sourceEntry: me.sourceEntry,
    confirmed: confirmed.map((c) => c.id).sort(),
    negatives: negatives.map((c) => c.id).sort(),
    // The results themselves: the retrieval snapshot the deck was built from, and the generation
    // counter whose every move is a re-search.
    retrieval: stored.retrieval,
    retrievalGeneration: stored.retrievalGeneration,
  };
}

async function claimByMagicLink(app: App, cookie: string) {
  const link = await app.inject({
    method: "POST",
    url: "/auth/request-link",
    headers: { cookie },
    payload: { email: "visitor@example.com" },
  });
  const token = new URL(link.json().devLink, "http://x").searchParams.get("token")!;
  const verified = await app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token } });
  expect(verified.statusCode).toBe(200);
  return verified;
}

describe("#64 claiming the anonymous session at the reveal", () => {
  // AC4. The wall is a server rule, not a screen: the job detail behind it is refused to an
  // unclaimed session that is holding a perfectly real, perfectly earned deck — and it is refused
  // for the ad she can actually see, not by hiding the id from her.
  it("refuses job detail to an unclaimed session, however earned its deck", async () => {
    const { app, cookie, earned } = await visitorAtTheReveal();
    const topAdId = earned.cards[0].adId;

    const want = await app.inject({ method: "POST", url: `/onboarding/cards/${topAdId}/want`, headers: { cookie } });
    expect(want.statusCode).toBe(401);
    expect(want.json().error.code).toBe("login_required");

    const tailor = await app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(tailor.statusCode).toBe(401);
    expect(tailor.json().error.code).toBe("login_required");
  });

  // AC2. Upload, intent, family version, answers, negatives and results all come through the claim
  // untouched, and the provider is never asked a second time — a claim that re-searched would spend
  // real money to re-buy a deck she had already earned.
  it("carries upload, intent, family version, answers, negatives and results through the claim", async () => {
    const { built, app, cookie, earned, uploadId, retrievals } = await visitorAtTheReveal();
    const before = await keptState(built, app, cookie);
    const searchesBefore = retrievals();
    expect(searchesBefore).toBeGreaterThan(0); // she really did earn a live deck

    await claimByMagicLink(app, cookie);

    const after = await keptState(built, app, cookie);
    expect(after.sessionId).toBe(before.sessionId); // the SAME session becomes hers — nothing is copied
    expect(after.intent).toEqual(before.intent);
    expect(after.discovery).toEqual(before.discovery);
    expect(after.sourceEntry).toEqual(before.sourceEntry);
    expect(after.confirmed).toEqual(before.confirmed);
    expect(after.negatives).toEqual(before.negatives);
    expect(after.negatives.length).toBeGreaterThan(0);
    expect(after.retrieval).toEqual(before.retrieval);
    expect(after.retrievalGeneration).toBe(before.retrievalGeneration);

    // Her upload is still hers: a session that had lost it would answer 403 "not your upload".
    const put = await app.inject({
      method: "PUT",
      url: `/uploads/${uploadId}/content`,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload: Buffer.from("%PDF-1.4 not a real cv"),
    });
    expect(put.statusCode).toBe(200);

    // The deck itself is the same deck, in the same order, and it cost nothing to come back to.
    const resumed = await deck(app, cookie);
    expect(resumed.authed).toBe(true);
    expect(resumed.cards.map((c) => c.adId)).toEqual(earned.cards.map((c) => c.adId));
    expect(retrievals()).toBe(searchesBefore);
  });

  // AC3, server half: the moment the claim lands, the highest-ranked job opens — the deck's first
  // card is the one the client lands on, and the route that was 401 a second ago now hands it over.
  // (The browser half — no second reveal in between — is apps/web/e2e/wall.spec.ts.)
  it("opens the highest-ranked job the moment claiming completes", async () => {
    const { app, cookie, earned } = await visitorAtTheReveal();
    const topAdId = earned.cards[0].adId;

    await claimByMagicLink(app, cookie);

    const want = await app.inject({ method: "POST", url: `/onboarding/cards/${topAdId}/want`, headers: { cookie } });
    expect(want.statusCode).toBe(200);
    expect(want.json()).toMatchObject({ stage: "tailor", adId: topAdId });

    const tailor = await app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(tailor.statusCode).toBe(200);
    expect(tailor.json().card.adId).toBe(topAdId);
  });
});
