// #20 profile screen (Sorted + Constellation) — the colour law derivation over HTTP, the spec's
// pinned seam (#11). Prior art: onboarding.test.ts (deck/build over real requests), discovery.test.ts
// (anonSession/signIn helpers for pre-wall vs post-wall routes).
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

// Three mined claims spanning distinct root-CV sections (experience, cert, skill) — same fixture
// shape as onboarding.test.ts's MINED, reused here to exercise domain grouping/ordering.
const MINED: CandidateClaim[] = [
  claim({ id: "acme-led-migration" }),
  claim({ id: "cert-pmp", role: "profile", text: "PMP, 2021." }),
  claim({ id: "skill-jira", role: "profile", text: "Jira" }),
];

function fakePipeline() {
  return { mine: async () => ({ doc: null, claims: MINED, roles: 1, needsGrill: 0 }) };
}

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });
const put = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "PUT", url, headers: { cookie }, payload });

async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
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

const ROLE = "IT project manager in Paris, mostly ERP";

interface ProfileFact {
  id: string;
  text: string;
  colour: "gold" | "grey";
  source: "told" | "read";
}
interface ProfileResponse {
  domains: Array<{ tag: string; heading: string; facts: ProfileFact[] }>;
  factCount: number;
}

describe("#20 profile screen — the colour law over HTTP", () => {
  it("returns gold confirmed facts, grey pending facts under the current product decision, and no rejected facts", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });

    // Confirm the experience claim (→ rendered → gold), leave the cert claim pending (never
    // confirmed → not rendered → grey), reject the skill claim (must vanish from the profile).
    await post(server.app, cookie, "/onboarding/claims/acme-led-migration/confirm");
    await post(server.app, cookie, "/onboarding/claims/skill-jira/reject");

    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    const { domains, factCount } = res.json() as ProfileResponse;

    // Domain order matches rootcv.ts's SECTIONS order (experience before cert), not insertion order.
    expect(domains.map((d) => d.tag)).toEqual(["experience", "cert"]);
    // The badge count is the server's confirmed+negative monotonic count, not the number of visible facts.
    expect(factCount).toBe(1);

    const experience = domains.find((d) => d.tag === "experience")!;
    expect(experience.heading).toBe("Professional Experience");
    expect(experience.facts).toEqual([{ id: "acme-led-migration", text: expect.any(String), colour: "gold", source: "read" }]);

    const cert = domains.find((d) => d.tag === "cert")!;
    expect(cert.facts.map((f) => f.id)).toEqual(["cert-pmp"]);
    expect(cert.facts[0]).toMatchObject({ colour: "grey", source: "read" });

    // The rejected claim is gone entirely — no domain lists it, gold or grey.
    const allIds = domains.flatMap((d) => d.facts.map((f) => f.id));
    expect(allIds).not.toContain("skill-jira");
  });

  it("source follows claim origin, not the claim id prefix", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e2@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });
    await put(server.app, cookie, "/onboarding/claims/acme-led-migration", {
      text: "Led the checkout replatform as programme owner.",
    });
    await post(server.app, cookie, "/onboarding/claims/cert-pmp/confirm");

    const { domains } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    const facts = domains.flatMap((d) => d.facts);
    const told = facts.find((f) => f.id === "acme-led-migration")!;
    const read = facts.find((f) => f.id === "cert-pmp")!;
    expect(told.source).toBe("told");
    expect(read.source).toBe("read");
  });

  it("returns the session-wide floored factCount even when visible profile facts shrink", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const answered = await post(server.app, cookie, "/onboarding/discovery/answer", {
      itemId: "budget-accountability",
      answer: "Yes, over $1M",
    });
    expect(answered.json().factCount).toBe(1);

    await signIn(server.app, cookie, "e2e3@example.com");
    await post(server.app, cookie, "/onboarding/claims/discovery-budget-accountability/reject");

    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [], factCount: 1 });
  });

  it("an empty profile (no claims yet) is 200 with no domains, not an error", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [], factCount: 0 });
  });

  it("requires a session (401 with no cookie) but is reachable pre-wall (an unverified anonymous session is not rejected)", async () => {
    const server = buildServer();
    const noCookie = await server.app.inject({ method: "GET", url: "/profile" });
    expect(noCookie.statusCode).toBe(401);

    const cookie = await anonSession(server.app);
    const preWall = await get(server.app, cookie, "/profile");
    expect(preWall.statusCode).toBe(200);
  });
});
