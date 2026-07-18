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
      expect(await s.consumeToken(sha256("raw1"))).toBe("a@x.com");
      expect(await s.consumeToken(sha256("raw1"))).toBeNull();
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
      expect(await s.consumeToken(sha256("new"))).toBe("a@x.com");
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

  it("verify with a bad token is 400; without a session is 401", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    expect(
      (await server.app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token: "garbage" } })).statusCode,
    ).toBe(400);
    expect(
      (await server.app.inject({ method: "POST", url: "/auth/verify", payload: { token: "garbage" } })).statusCode,
    ).toBe(401); // no session
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
