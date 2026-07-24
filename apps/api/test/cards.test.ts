// #19 the reveal + the job card (screen 2a) — the pinned HTTP seam: GET /onboarding/cards over a
// real request, driven through the real discovery flow (prior art: discovery.test.ts). Asserts
// the response the frontend is pinned against, not handler internals: card shape, score-sorted
// order, and that a recorded "no" lands in askedClosed (never re-asked, never a gap).
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

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
  it("rides the anonymous session (no wall) and mirrors the session's own persisted stage", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stage: string; cards: JobCard[] };
    expect(body.stage).toBe(me.json().stage); // reveal-gated client-side, not blocked server-side
    expect(body.cards.length).toBeGreaterThanOrEqual(3); // reconciled stub: >=3 scorable cards
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
        adId: expect.any(String),
        title: expect.any(String),
        company: expect.any(String),
        place: expect.any(String),
        matchPct: expect.any(Number),
        bubble: { hit: expect.any(String), open: expect.any(String) },
        adExcerpt: expect.any(String),
      });
      expect(card.salary).toBeNull(); // absent in the stub postings
      expect(card.pattern).toBeNull();
      expect(card.matchPct).toBeGreaterThanOrEqual(0);
      expect(card.matchPct).toBeLessThanOrEqual(100);
      expect(Array.isArray(card.fit)).toBe(true);
      expect(Array.isArray(card.dontYet)).toBe(true);
      expect(Array.isArray(card.askedClosed)).toBe(true);
      for (const req of card.dontYet) {
        expect(["must", "should", "nice"]).toContain(req.band);
      }
    }

    // Sorted by matchPct descending (best first).
    for (let i = 1; i < body.cards.length; i++) {
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
