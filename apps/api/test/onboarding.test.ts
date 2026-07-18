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
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
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
