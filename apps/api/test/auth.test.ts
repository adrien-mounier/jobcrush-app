// E2 auth — the token/user store (both drivers via pg-mem) and the magic-link routes, with the
// security ACs: single-use, expiry, prior-invalidation, rate limit, no enumeration, session claim.
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { buildServer } from "../src/server.js";
import { InMemoryAuthStore, PgAuthStore, type AuthStore } from "../src/auth.js";
import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const authDrivers: [string, () => AuthStore][] = [
  ["in-memory", () => new InMemoryAuthStore()],
  ["postgres (pg-mem)", () => new PgAuthStore(pgPool())],
];

for (const [name, make] of authDrivers) {
  describe(`AuthStore contract — ${name}`, () => {
    it("token is single-use: consume once returns the email, again returns null", async () => {
      const s = make();
      await s.init();
      await s.createToken("a@x.com", sha256("raw1"), future());
      expect(await s.consumeToken(sha256("raw1"))).toMatchObject({ email: "a@x.com" });
      expect(await s.consumeToken(sha256("raw1"))).toBeNull();
    });

    it("carries the requesting session id through consume (JC-18 cross-browser)", async () => {
      const s = make();
      await s.init();
      await s.createToken("a@x.com", sha256("raw-s"), future(), "sess-abc");
      expect(await s.consumeToken(sha256("raw-s"))).toEqual({ email: "a@x.com", pendingSessionId: "sess-abc" });
    });

    it("expired token does not consume", async () => {
      const s = make();
      await s.init();
      await s.createToken("a@x.com", sha256("raw2"), past());
      expect(await s.consumeToken(sha256("raw2"))).toBeNull();
    });

    it("a new token for the same email invalidates the prior one", async () => {
      const s = make();
      await s.init();
      await s.createToken("a@x.com", sha256("old"), future());
      await s.createToken("a@x.com", sha256("new"), future());
      expect(await s.consumeToken(sha256("old"))).toBeNull();
      expect(await s.consumeToken(sha256("new"))).toMatchObject({ email: "a@x.com" });
    });

    it("upsertUser is idempotent by email; getUserById round-trips", async () => {
      const s = make();
      await s.init();
      const u1 = await s.upsertUser("a@x.com");
      const u2 = await s.upsertUser("a@x.com");
      expect(u2.id).toBe(u1.id);
      expect(await s.getUserById(u1.id)).toEqual(u1);
      expect(await s.getUserById("nope")).toBeNull();
    });
  });
}

async function anonSession(app: ReturnType<typeof buildServer>["app"]) {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
const tokenOf = (devLink: string) => new URL("http://x" + devLink).searchParams.get("token")!;

describe("E2 auth routes", () => {
  it("request-link returns a dev link (no real mailer) with a uniform 200", async () => {
    const server = buildServer();
    const res = await server.app.inject({
      method: "POST",
      url: "/auth/request-link",
      payload: { email: "New.User@Example.com " }, // trimmed + lowercased inside
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().devLink).toMatch(/^\/auth\/verify\?token=/);
  });

  it("rate-limits the email endpoint (5 / window, then 429)", async () => {
    const server = buildServer();
    for (let i = 0; i < 5; i++) {
      const ok = await server.app.inject({ method: "POST", url: "/auth/request-link", payload: { email: `u${i}@x.com` } });
      expect(ok.statusCode).toBe(200);
    }
    const blocked = await server.app.inject({ method: "POST", url: "/auth/request-link", payload: { email: "u6@x.com" } });
    expect(blocked.statusCode).toBe(429);
  });

  it("verify claims the session for the user; the link is single-use", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const link = await server.app.inject({ method: "POST", url: "/auth/request-link", headers: { cookie }, payload: { email: "a@x.com" } });
    const token = tokenOf(link.json().devLink);

    const verified = await server.app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.email).toBe("a@x.com");

    // the session is now claimed…
    const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().claimedByUserId).toBeTruthy();
    // …and the token can't be replayed.
    const replay = await server.app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token } });
    expect(replay.statusCode).toBe(400);
  });

  it("cross-browser: verify claims the REQUESTING session and re-homes the opener", async () => {
    const server = buildServer();
    const cookieA = await anonSession(server.app); // the browser that uploaded — holds the job/deck
    const cookieB = await anonSession(server.app); // the mail-app webview that opens the link
    const tokenA = cookieA.split("=")[1];

    const link = await server.app.inject({ method: "POST", url: "/auth/request-link", headers: { cookie: cookieA }, payload: { email: "a@x.com" } });
    const token = tokenOf(link.json().devLink);

    // Open the link in browser B (a different session entirely).
    const verified = await server.app.inject({ method: "POST", url: "/auth/verify", headers: { cookie: cookieB }, payload: { token } });
    expect(verified.statusCode).toBe(200);

    // Session A — the requester, holding the job — is the one claimed, so its deck now opens.
    const meA = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie: cookieA } });
    expect(meA.json().claimedByUserId).toBeTruthy();
    // …and the opener (B) is re-homed onto A: its response cookie now carries A's token.
    expect(verified.cookies.find((c) => c.name === "jc_session")?.value).toBe(tokenA);
  });

  it("verify with a bad token is 400 regardless of session; a valid token with no session to claim is 401", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    // A bad link is 400 whether or not you hold a session — the token is what's invalid.
    expect(
      (await server.app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token: "garbage" } })).statusCode,
    ).toBe(400);
    expect(
      (await server.app.inject({ method: "POST", url: "/auth/verify", payload: { token: "garbage" } })).statusCode,
    ).toBe(400);
    // A valid token requested with no session, opened with no session → nothing to attach → 401.
    const link = await server.app.inject({ method: "POST", url: "/auth/request-link", payload: { email: "b@x.com" } });
    const token = tokenOf(link.json().devLink);
    expect(
      (await server.app.inject({ method: "POST", url: "/auth/verify", payload: { token } })).statusCode,
    ).toBe(401); // no session to claim
  });

  it("the wall is server-side: the deck is 401 login_required without a claimed session", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "POST", url: "/onboarding/deck", headers: { cookie }, payload: { jobId: "x" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("login_required");
  });

  it("logout clears the session cookie", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === "jc_session")?.value).toBe("");
  });
});

// Google OAuth (ported from vitacairn). The code→email exchange is injected; the routes own the
// state CSRF cookie and the same claim seam as magic-link verify.
describe("E2 auth — Google OAuth", () => {
  it("/auth/google redirects to signup?login=error when Google is not configured", async () => {
    const server = buildServer(); // no googleEmail injected, no GOOGLE_CLIENT_ID in test env
    const res = await server.app.inject({ method: "GET", url: "/auth/google" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/signup?login=error");
  });

  it("callback with a bad or absent state is rejected (CSRF guard)", async () => {
    const server = buildServer({ googleEmail: async () => "a@x.com" });
    const res = await server.app.inject({ method: "GET", url: "/auth/google/callback?code=x&state=forged" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/signup?login=expired");
  });

  it("happy path: /auth/google sets state → callback claims the anonymous session for the user", async () => {
    const server = buildServer({ googleEmail: async (code) => (code === "good-code" ? "g@x.com" : null) });
    const cookie = await anonSession(server.app);

    const start = await server.app.inject({ method: "GET", url: "/auth/google", headers: { cookie } });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("accounts.google.com");
    const state = start.cookies.find((c) => c.name === "jc_oauth_state")!.value;
    expect(start.headers.location).toContain(`state=${state}`);

    const cb = await server.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=good-code&state=${state}`,
      headers: { cookie: `${cookie}; jc_oauth_state=${state}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain("/auth/verify?oauth=ok");

    // The anonymous session is claimed (the JC-19 merge) — the wall opens for this browser.
    const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().claimedByUserId).toBeTruthy();
  });

  it("callback with an exchange that fails (bad code) never claims the session", async () => {
    const server = buildServer({ googleEmail: async () => null });
    const cookie = await anonSession(server.app);
    const start = await server.app.inject({ method: "GET", url: "/auth/google", headers: { cookie } });
    const state = start.cookies.find((c) => c.name === "jc_oauth_state")!.value;
    const cb = await server.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=bad&state=${state}`,
      headers: { cookie: `${cookie}; jc_oauth_state=${state}` },
    });
    expect(cb.headers.location).toContain("/signup?login=expired");
    const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().claimedByUserId).toBeNull();
  });

  // The #22 return path: a failed round-trip started at the /deck wall lands back on the wall (which
  // already showed the reveal) instead of dumping the visitor on /signup.
  it("a failure returns to the door the trip started at (?from=/deck)", async () => {
    const server = buildServer({ googleEmail: async () => null });
    const cookie = await anonSession(server.app);
    const start = await server.app.inject({
      method: "GET",
      url: "/auth/google?from=/deck",
      headers: { cookie },
    });
    const state = start.cookies.find((c) => c.name === "jc_oauth_state")!.value;
    expect(start.cookies.find((c) => c.name === "jc_oauth_from")?.value).toBe("/deck");

    const cb = await server.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=bad&state=${state}`,
      headers: { cookie: `${cookie}; jc_oauth_state=${state}; jc_oauth_from=/deck` },
    });
    expect(cb.headers.location).toBe("/deck?login=expired");
  });

  it("an unconfigured Google also returns to the starting door", async () => {
    const server = buildServer(); // no googleEmail, no GOOGLE_CLIENT_ID
    const res = await server.app.inject({ method: "GET", url: "/auth/google?from=/deck" });
    expect(res.headers.location).toBe("/deck?login=error");
  });

  it("an off-allowlist return path is refused, never redirected to (open-redirect guard)", async () => {
    const server = buildServer({ googleEmail: async () => null });
    // Both doors: the query param on the way out…
    const start = await server.app.inject({ method: "GET", url: "/auth/google?from=//evil.com" });
    expect(start.headers.location).toContain("accounts.google.com");
    expect(start.cookies.find((c) => c.name === "jc_oauth_from")?.value).toBe("/signup");

    // …and a hand-forged cookie on the way back.
    const state = start.cookies.find((c) => c.name === "jc_oauth_state")!.value;
    const cb = await server.app.inject({
      method: "GET",
      url: `/auth/google/callback?code=bad&state=${state}`,
      headers: { cookie: `jc_oauth_state=${state}; jc_oauth_from=https://evil.com` },
    });
    expect(cb.headers.location).toBe("/signup?login=expired");
  });
});
