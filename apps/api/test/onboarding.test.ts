// JC-21/27/31 slice A — the deck + build loop end to end over HTTP. This is the first test that
// drives the E4 spine (buildClaimGraph → renderRootCv → runGate) through a real request:
// paste → mine → open deck → confirm/edit/reject → build → `ready`, root CV traces clean.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { isTerminal } from "../src/jobs.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  role: "Acme — PM",
  text: "Led the checkout replatform, delivered 2 months early.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

// Three mined claims covering distinct root-CV sections (experience, cert, skill).
const MINED: CandidateClaim[] = [
  claim({ id: "acme-led-migration" }),
  claim({ id: "cert-pmp", role: "profile", text: "PMP, 2021." }),
  claim({ id: "skill-jira", role: "profile", text: "Jira" }),
];

function fakePipeline() {
  return { mine: async () => ({ doc: null, claims: MINED, roles: 1, needsGrill: 0 }) };
}

async function startSession(app: ReturnType<typeof buildServer>["app"]) {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  // E2 wall: onboarding routes require a claimed session — log in via the magic-link (dev mailer
  // returns the link), so every onboarding test starts from a logged-in session.
  const link = await app.inject({
    method: "POST",
    url: "/auth/request-link",
    headers: { cookie },
    payload: { email: "e2e@example.com" },
  });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await app.inject({ method: "POST", url: "/auth/verify", headers: { cookie }, payload: { token } });
  return cookie;
}

async function waitTerminal(server: ReturnType<typeof buildServer>, jobId: string) {
  await new Promise<void>((resolve) => {
    const un = server.store.subscribe(jobId, (j) => {
      if (isTerminal(j.status)) {
        un();
        resolve();
      }
    });
    void server.store.get(jobId).then((j) => {
      if (j && isTerminal(j.status)) {
        un();
        resolve();
      }
    });
  });
}

async function mineAndGetJob(server: ReturnType<typeof buildServer>, cookie: string) {
  const created = await server.app.inject({
    method: "POST",
    url: "/cv/paste",
    headers: { cookie },
    payload: { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
  });
  const { jobId } = created.json();
  await waitTerminal(server, jobId);
  return jobId as string;
}

describe("JC-21/27/31 onboarding deck → build loop", () => {
  it("confirm + edit + reject → build flips the session to ready with a clean-tracing root CV", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    const jobId = await mineAndGetJob(server, cookie);

    // Open the deck — seeded from the job's mined claims, all pending.
    const deck = await server.app.inject({
      method: "POST",
      url: "/onboarding/deck",
      headers: { cookie },
      payload: { jobId },
    });
    expect(deck.statusCode).toBe(200);
    expect(deck.json().stage).toBe("deck");
    const seeded = deck.json().claims as Array<{ id: string; decision: string }>;
    expect(seeded.map((c) => c.id).sort()).toEqual(["acme-led-migration", "cert-pmp", "skill-jira"]);
    expect(seeded.every((c) => c.decision === "pending")).toBe(true);

    // Confirm one, edit one (→ user-authored, auto-confirmed), reject one.
    const call = (method: "POST" | "PUT", url: string, payload?: unknown) =>
      server.app.inject({ method, url, headers: { cookie }, payload });
    expect((await call("POST", "/onboarding/claims/acme-led-migration/confirm")).statusCode).toBe(200);
    expect((await call("PUT", "/onboarding/claims/cert-pmp", { text: "PMP and PgMP, 2021." })).statusCode).toBe(200);
    expect((await call("POST", "/onboarding/claims/skill-jira/reject")).statusCode).toBe(200);

    // Build the root CV over the confirmed claims and run the gate.
    const built = await call("POST", "/onboarding/build");
    expect(built.statusCode).toBe(200);
    const body = built.json();
    expect(body.stage).toBe("ready");
    expect(body.gate).toEqual({ ok: true, errors: [] });

    const md = body.rootCv.markdown as string;
    expect(md).toContain("Led the checkout replatform"); // confirmed
    expect(md).toContain("PMP and PgMP, 2021."); // edited text, not the original
    expect(md).not.toContain("Jira"); // rejected — dropped

    // Every rendered bullet traces to a confirmed node (the anti-fabrication invariant, §8-3).
    const traced = (body.rootCv.trace.entries as Array<{ nodeIds: string[] }>).flatMap((e) => e.nodeIds);
    expect(traced.sort()).toEqual(["acme-led-migration", "cert-pmp"]);

    // The session persisted the new stage for a reload.
    const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("ready");
  });

  it("building with nothing confirmed loops back instead of certifying an empty CV", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    const jobId = await mineAndGetJob(server, cookie);
    await server.app.inject({
      method: "POST",
      url: "/onboarding/deck",
      headers: { cookie },
      payload: { jobId },
    });
    // Confirm nothing, then build: an empty confirmed set is a loop-back, never a `ready` empty CV.
    const built = await server.app.inject({ method: "POST", url: "/onboarding/build", headers: { cookie } });
    const body = built.json();
    expect(body.stage).toBe("loopback");
    expect(body.gate.ok).toBe(false);
    expect(body.gate.errors.join(" ")).toMatch(/at least one fact/i);
  });

  it("tiers the deck by machine_touch: verbatim batches, machine-touched goes individual (JC-22)", async () => {
    const server = buildServer({
      pipeline: {
        mine: async () => ({
          doc: null,
          roles: 1,
          needsGrill: 0,
          claims: [
            claim({ id: "acme-verbatim", machine_touch: "verbatim" }),
            claim({ id: "acme-reworded", machine_touch: "reworded" }),
          ],
        }),
      },
    });
    const cookie = await startSession(server.app);
    const jobId = await mineAndGetJob(server, cookie);
    const deck = await server.app.inject({
      method: "POST",
      url: "/onboarding/deck",
      headers: { cookie },
      payload: { jobId },
    });
    const tierById = Object.fromEntries(
      (deck.json().claims as Array<{ id: string; tier: string }>).map((c) => [c.id, c.tier]),
    );
    expect(tierById["acme-verbatim"]).toBe("batch");
    expect(tierById["acme-reworded"]).toBe("individual");
  });

  // #28 MUST-FIX: ClaimRecord grew an internal `seq` ordinal (the store's monotonic answer order,
  // for tailor.ts's ledger replay) — the route has no response schema to strip it, so a naive
  // `{ ...c, tier }` spread would leak it onto the wire. On Postgres `seq` is a TABLE-GLOBAL
  // bigserial, so it'd disclose the delta in OTHER sessions' write volume between two of a visitor's
  // own requests — pin it off, not just fix it once.
  it("the deck payload never carries the internal `seq` ordinal (#28)", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await startSession(server.app);
    const jobId = await mineAndGetJob(server, cookie);
    const deck = await server.app.inject({
      method: "POST",
      url: "/onboarding/deck",
      headers: { cookie },
      payload: { jobId },
    });
    const claims = deck.json().claims as Array<Record<string, unknown>>;
    expect(claims.length).toBeGreaterThan(0); // sanity: there's something that COULD leak it
    for (const c of claims) expect(Object.prototype.hasOwnProperty.call(c, "seq")).toBe(false);
  });

  it("build audits mined wording but never user-authored words, and a dead auditor never blocks (decision #6)", async () => {
    const server = buildServer({
      pipeline: fakePipeline(),
      // Polishes every bullet it is shown; the route must only show it MINED bullets.
      auditCv: async (bullets) => bullets.map((b) => `${b.text} (polished)`),
    });
    const cookie = await startSession(server.app);
    const jobId = await mineAndGetJob(server, cookie);
    await server.app.inject({ method: "POST", url: "/onboarding/deck", headers: { cookie }, payload: { jobId } });
    const call = (method: "POST" | "PUT", url: string, payload?: unknown) =>
      server.app.inject({ method, url, headers: { cookie }, payload });
    await call("POST", "/onboarding/claims/acme-led-migration/confirm"); // mined → audited
    await call("PUT", "/onboarding/claims/cert-pmp", { text: "PMP and PgMP, 2021." }); // user-authored → untouched
    await call("POST", "/onboarding/claims/skill-jira/reject");

    const body = (await call("POST", "/onboarding/build")).json();
    expect(body.stage).toBe("ready");
    expect(body.gate).toEqual({ ok: true, errors: [] }); // the gate certifies the AUDITED trace
    const md = body.rootCv.markdown as string;
    expect(md).toContain("Led the checkout replatform, delivered 2 months early. (polished)");
    expect(md).toContain("PMP and PgMP, 2021."); // the user's own words, exactly
    expect(md).not.toContain("PMP and PgMP, 2021. (polished)");

    // An auditor that dies never takes the build down: same session, audit now throws → unaudited CV.
    const down = buildServer({
      pipeline: fakePipeline(),
      auditCv: async () => { throw new Error("model down"); },
    });
    const cookie2 = await startSession(down.app);
    const jobId2 = await mineAndGetJob(down, cookie2);
    await down.app.inject({ method: "POST", url: "/onboarding/deck", headers: { cookie: cookie2 }, payload: { jobId: jobId2 } });
    await down.app.inject({ method: "POST", url: "/onboarding/claims/acme-led-migration/confirm", headers: { cookie: cookie2 } });
    const body2 = (await down.app.inject({ method: "POST", url: "/onboarding/build", headers: { cookie: cookie2 } })).json();
    expect(body2.stage).toBe("ready");
    expect(body2.rootCv.markdown).toContain("Led the checkout replatform, delivered 2 months early.");
  });

  it("the deck is session-scoped: another session cannot open your job", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const mine = await startSession(server.app);
    const theirs = await startSession(server.app);
    const jobId = await mineAndGetJob(server, mine);
    const res = await server.app.inject({
      method: "POST",
      url: "/onboarding/deck",
      headers: { cookie: theirs },
      payload: { jobId },
    });
    expect(res.statusCode).toBe(404);
  });
});
