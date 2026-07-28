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
