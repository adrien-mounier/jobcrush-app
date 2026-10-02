import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { IpRateLimiter } from "../src/sessions.js";

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((c) => c.name === "jc_session");
  if (!c) throw new Error("no session cookie set");
  return `jc_session=${c.value}`;
}

describe("JC-10 anonymous sessions", () => {
  it("POST /sessions/anonymous issues an httpOnly SameSite=Lax cookie and a row with TTL fields", async () => {
    const { app, sessions } = buildServer();
    const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === "jc_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    const session = await sessions.getByToken(cookie!.value);
    expect(session).toMatchObject({ id: res.json().id, claimedByUserId: null });
    expect(session?.createdAt).toBeTruthy();
    expect(session?.lastSeenAt).toBeTruthy();
  });

  it("routes authorize against the session: /sessions/me 401 without, 200 with", async () => {
    const { app } = buildServer();
    expect((await app.inject({ method: "GET", url: "/sessions/me" })).statusCode).toBe(401);
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const res = await app.inject({
      method: "GET",
      url: "/sessions/me",
      headers: { cookie: cookieOf(created) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeUndefined(); // token never echoed back
  });

  it("bearer token works as the non-browser fallback", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const token = created.cookies.find((c) => c.name === "jc_session")!.value;
    const res = await app.inject({
      method: "GET",
      url: "/sessions/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("stores target titles on the session", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const put = await app.inject({
      method: "PUT",
      url: "/sessions/me/targets",
      headers: { cookie },
      payload: { targetTitles: ["IT Project Manager", "Product Owner"] },
    });
    expect(put.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().targetTitles).toEqual(["IT Project Manager", "Product Owner"]);
  });

  // #248 — the session a visitor can read in her own browser carries NO retrieved postings. The
  // field held the whole live advert list (titles, companies, source URLs) and no client reads it;
  // left in, it is a door onto the posting pool that none of the three authorization guards cover.
  // Unreachable while nothing fetches before coverage — #246 fetches at question 1 on purpose, and
  // would hand every unearned visitor the full job list in devtools. A QA mutation proved putting
  // the field back left the whole api suite green, so this is the twelve-second signal for it.
  it("never hands the visitor her own retrieved posting pool", async () => {
    const { app, sessions } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).not.toHaveProperty("retrieval");
    expect(me.json()).not.toHaveProperty("token");
    // The record itself still HAS the field — this is a withholding at the door, not a data change,
    // so a test asserting the store forgot it would be asserting the wrong thing.
    expect(await sessions.getById(created.json().id)).toHaveProperty("retrieval");
    // What the route does still serve is unchanged: the discovery record journeys read off it.
    expect(me.json()).toHaveProperty("discovery");
  });

  it("persists and restores the anonymous source-entry checkpoint", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    expect(
      (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().sourceEntry,
    ).toBeNull();

    const invited = await app.inject({
      method: "PUT",
      url: "/sessions/me/source-entry",
      headers: { cookie },
      payload: { checkpoint: "invited", choice: null },
    });
    expect(invited.statusCode).toBe(200);
    expect(invited.json()).toEqual({ sourceEntry: { checkpoint: "invited", choice: null } });

    const selected = await app.inject({
      method: "PUT",
      url: "/sessions/me/source-entry",
      headers: { cookie },
      payload: { checkpoint: "source_selected", choice: "questions" },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toEqual({
      sourceEntry: { checkpoint: "source_selected", choice: "questions" },
    });
    const restored = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(restored.json().sourceEntry).toEqual({
      checkpoint: "source_selected",
      choice: "questions",
    });
  });

  it("recovers both missing intent fields without match-like claims", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const response = await app.inject({
      method: "GET",
      url: "/sessions/me/intent",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      intent: { targetRole: null, searchAreas: [] },
      missing: ["targetRole", "searchArea"],
      checkpoint: "intent_needed",
      refused: [], // #214: nothing written this request, nothing refused
      coverage: ["Hong Kong", "Singapore", "Vietnam", "Australia"],
    });
    expect(Array.isArray(body.areaVocabulary)).toBe(true);
    expect(body.areaVocabulary.length).toBeGreaterThan(0);
    expect(response.json()).not.toHaveProperty("jobCount");
    expect(response.json()).not.toHaveProperty("matches");
    expect(response.json()).not.toHaveProperty("family");
  });

  it("accepts both intent fields together, restores them, and merges a partial update", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const accepted = await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "  Programme Manager  ", searchArea: "  Hong Kong  " },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      intent: {
        targetRole: "Programme Manager",
        searchAreas: [
          {
            text: "Hong Kong",
            marketKey: "hong-kong",
            statedAt: expect.any(String),
            market: "Hong Kong",
            label: "Hong Kong",
          },
        ],
      },
      missing: [],
      checkpoint: "intent_known",
      refused: [],
    });
    // #214: `searchAreas` REPLACES the whole list; a city resolves to its own label + country market.
    const updated = await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { searchAreas: ["Singapore", "Sydney"] },
    });
    expect(updated.json()).toMatchObject({
      intent: {
        targetRole: "Programme Manager",
        searchAreas: [
          {
            text: "Singapore",
            marketKey: "singapore",
            statedAt: expect.any(String),
            market: "Singapore",
            label: "Singapore",
          },
          {
            text: "Sydney",
            marketKey: "australia",
            statedAt: expect.any(String),
            market: "Australia",
            label: "Sydney",
          },
        ],
      },
      missing: [],
      checkpoint: "intent_known",
      refused: [],
    });
    const restored = await app.inject({
      method: "GET",
      url: "/sessions/me",
      headers: { cookie },
    });
    expect(restored.json().intent).toEqual({
      targetRole: "Programme Manager",
      searchAreas: [
        { text: "Singapore", marketKey: "singapore", statedAt: expect.any(String) },
        { text: "Sydney", marketKey: "australia", statedAt: expect.any(String) },
      ],
    });
  });

  // #184's server-side coverage gate, carried forward under #214's semantics: an uncovered area is
  // now REFUSED — never stored, reported in `refused` on the write that carried it — and the
  // checkpoint stays intent_needed. Repro pinned: type "Bangkok" -> refusal message -> reload ->
  // nothing stored, nothing passes silently onward (the exact #172 complaint).
  it("an uncovered search area is refused, never stored, and never advances the checkpoint (server-side gate)", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const COVERAGE = ["Hong Kong", "Singapore", "Vietnam", "Australia"];

    const accepted = await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Programme Manager", searchArea: "Bangkok" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      intent: { targetRole: "Programme Manager", searchAreas: [] }, // NOT stored
      missing: ["searchArea"], // still unmet — a refused area is not a satisfied intent
      checkpoint: "intent_needed", // NEVER intent_known on an uncovered area
      refused: [{ text: "Bangkok", coverage: COVERAGE }],
    });

    // The gate survives a reload too — GET shows nothing stored (refusals are per-write, so []).
    const reloaded = await app.inject({ method: "GET", url: "/sessions/me/intent", headers: { cookie } });
    expect(reloaded.json()).toMatchObject({
      intent: { targetRole: "Programme Manager", searchAreas: [] },
      missing: ["searchArea"],
      checkpoint: "intent_needed",
      refused: [],
    });

    // Correcting to a covered area is what actually advances the checkpoint.
    const corrected = await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { searchArea: "Hong Kong" },
    });
    expect(corrected.json()).toMatchObject({
      intent: {
        targetRole: "Programme Manager",
        searchAreas: [
          {
            text: "Hong Kong",
            marketKey: "hong-kong",
            statedAt: expect.any(String),
            market: "Hong Kong",
            label: "Hong Kong",
          },
        ],
      },
      missing: [],
      checkpoint: "intent_known",
      refused: [],
    });
  });

  it("asks only for the missing field when explicit intent already has one value", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const accepted = await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Delivery Lead" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().missing).toEqual(["searchArea"]);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/me/intent",
      headers: { cookie },
    });
    expect(response.json()).toMatchObject({
      intent: { targetRole: "Delivery Lead", searchAreas: [] },
      missing: ["searchArea"],
      checkpoint: "intent_needed",
      refused: [],
    });
  });

  it("does not promote imported history or residence into job-search intent", async () => {
    const { app, sessions } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    await sessions.setImportProof(created.json().id, {
      outcome: "success",
      usefulFactCount: 2,
      representativeFacts: [
        { id: "role-title", text: "Worked as a Project Manager", provenance: "cv" },
        { id: "residence", text: "Lives in Bangkok", provenance: "cv" },
      ],
      conflict: null,
    });
    const response = await app.inject({
      method: "GET",
      url: "/sessions/me/intent",
      headers: { cookie },
    });
    expect(response.json().intent).toEqual({ targetRole: null, searchAreas: [] });
  });

  it("requires a session and rejects invalid intent writes", async () => {
    const { app } = buildServer();
    const noSession = await app.inject({ method: "GET", url: "/sessions/me/intent" });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json()).toEqual({
      error: { code: "no_session", message: "no active session" },
    });
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    for (const payload of [
      {},
      { targetRole: "" },
      { searchArea: "   " },
      { targetRole: "PM", extra: true },
      { searchAreas: ["Hong Kong", "Singapore", "Sydney", "Melbourne"] }, // #214: max 3
      { searchAreas: [""] },
    ]) {
      const invalid = await app.inject({
        method: "PUT",
        url: "/sessions/me/intent",
        headers: { cookie },
        payload,
      });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it("persists an import correction without changing unrelated facts", async () => {
    const { app, sessions } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const session = await sessions.getById(created.json().id);
    await sessions.setImportProof(session!.id, {
      outcome: "success",
      usefulFactCount: 2,
      representativeFacts: [
        { id: "role-acme", text: "Led Acme delivery", provenance: "cv" },
        { id: "skill-sql", text: "Used SQL", provenance: "cv" },
      ],
      conflict: null,
    });

    const corrected = await app.inject({
      method: "PUT",
      url: "/sessions/me/import-resolution",
      headers: { cookie },
      payload: { fieldId: "role-acme", value: "Led global Acme delivery" },
    });

    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().importProof.representativeFacts).toEqual([
      { id: "role-acme", text: "Led global Acme delivery", provenance: "cv" },
      { id: "skill-sql", text: "Used SQL", provenance: "cv" },
    ]);
    expect((await sessions.getById(session!.id))?.importResolutions).toEqual({
      "role-acme": "Led global Acme delivery",
    });
  });

  it("requires a session before storing a source-entry checkpoint", async () => {
    const res = await appWithoutSession().inject({
      method: "PUT",
      url: "/sessions/me/source-entry",
      payload: { checkpoint: "invited", choice: null },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "no_session", message: "no active session" } });
  });

  it.each([
    { checkpoint: "unknown", choice: null },
    { checkpoint: "source_selected" },
    { checkpoint: "source_selected", choice: null },
    { checkpoint: "source_selected", choice: "linkedin" },
    { checkpoint: "invited", choice: "cv" },
    { checkpoint: "invited", choice: null, extra: true },
  ])("rejects invalid source-entry shape without mutation: %j", async (payload) => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const put = await app.inject({
      method: "PUT",
      url: "/sessions/me/source-entry",
      headers: { cookie },
      payload,
    });
    expect(put.statusCode).toBe(400);
    const restored = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(restored.json().sourceEntry).toBeNull();
  });

  // #15 front door → discovery handoff: the same anonymous-friendly seam as /targets above.
  it("advances the session to the discovery stage, persisted", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const put = await app.inject({
      method: "PUT",
      url: "/sessions/me/stage",
      headers: { cookie },
      payload: { stage: "discovery" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("discovery");
  });

  it("rejects an out-of-enum stage — fails closed rather than persisting an unknown value", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = cookieOf(created);
    const put = await app.inject({
      method: "PUT",
      url: "/sessions/me/stage",
      headers: { cookie },
      payload: { stage: "ready" },
    });
    expect(put.statusCode).toBe(400);
  });

  it("session creation is rate-limited per IP", async () => {
    const { app } = buildServer();
    // default limiter allows 12/hour from one IP; inject uses the same remoteAddress every time
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
      expect(res.statusCode).toBe(201);
    }
    const blocked = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("IpRateLimiter windows are per IP and reset after the window", () => {
    const limiter = new IpRateLimiter(2, 1000);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true); // separate IP unaffected
  });
});

function appWithoutSession() {
  return buildServer().app;
}
