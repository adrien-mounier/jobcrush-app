// #16 discovery (screen 1a) — the pure line/family helpers + the discovery HTTP API (the spec's
// primary seam: every server-decided behaviour observed through the route). Prior art:
// onboarding.test.ts (real requests over the spine) and preview.test.ts (pure helpers).
import { describe, expect, it } from "vitest";
import type { FloorItem } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import {
  composeCvLine,
  composeRoleLine,
  discoveryState,
  isNoAnswer,
  parseCity,
  resolveFamily,
  type DiscoveryState,
} from "../src/discovery.js";

const item = (over: Partial<FloorItem>): FloorItem => ({
  id: "x",
  rankBand: "essential",
  question: "Have you owned a project budget?",
  options: ["Yes, over $1M", "Yes, under $1M", "No"],
  cvSection: "experience",
  noIsFatal: true,
  ...over,
});

describe("#16 discovery pure helpers", () => {
  it("composeCvLine — a 'Have you …?' item becomes a dash-form line with the answer's qualifier", () => {
    expect(composeCvLine(item({}), "Yes, over $1M")).toBe("Owned a project budget — over $1M.");
    expect(composeCvLine(item({ question: "Have you maintained a risk register (RAID log)?" }), "Yes")).toBe(
      "Maintained a risk register (RAID log).",
    );
  });

  it("composeCvLine — a 'Which …?' item becomes a 'topic: answer' line", () => {
    const methodology = item({
      question: "Which delivery methodology have you worked in?",
      options: ["Agile/Scrum", "Waterfall", "Both"],
      cvSection: "skills",
    });
    expect(composeCvLine(methodology, "Agile/Scrum")).toBe("Delivery methodology: Agile/Scrum.");
  });

  it("composeCvLine — a free-text item (no options) is the visitor's own words verbatim", () => {
    const headline = item({ question: "What's the one line you want first on your CV?", options: [] });
    expect(composeCvLine(headline, "Delivery leader, 12 years in ERP")).toBe("Delivery leader, 12 years in ERP.");
  });

  it("composeCvLine is deterministic — same answer+item yields the same line", () => {
    expect(composeCvLine(item({}), "Yes, under $1M")).toBe(composeCvLine(item({}), "Yes, under $1M"));
  });

  it("composeRoleLine takes the first clause of Q1; parseCity lifts the city or null", () => {
    expect(composeRoleLine("it project manager in Paris, mostly ERP")).toBe("It project manager in Paris");
    expect(parseCity("IT project manager in Paris, mostly ERP")).toBe("Paris");
    expect(parseCity("based in New York")).toBe("New York");
    expect(parseCity("project manager")).toBeNull();
  });

  it("resolveFamily places any title into the family (silent no-match); empty query → no suggestions", () => {
    expect(resolveFamily("nurse practitioner").family).toBe("IT Project Manager"); // stub: one family
    expect(resolveFamily("anything").suggestions.length).toBeGreaterThan(0);
    expect(resolveFamily("").suggestions).toEqual([]);
  });

  it("isNoAnswer matches only a bare 'no' — a hedged 'No, but …' asserts a fact and is conserved", () => {
    expect(isNoAnswer("No")).toBe(true);
    expect(isNoAnswer("no")).toBe(true);
    expect(isNoAnswer("No.")).toBe(true);
    expect(isNoAnswer("No, but a related certification")).toBe(false);
    expect(isNoAnswer("Yes, over $1M")).toBe(false);
  });

  it("discoveryState before Q1 (no role) is the empty skeleton", () => {
    const s = discoveryState(null, [], []);
    expect(s).toMatchObject({ role: null, promise: null, questions: [], essentialRemaining: 0, cvLines: [] });
    expect(s.railFill).toEqual({ summary: 0, experience: 0, skills: 0, education: 0 });
  });
});

// --- routes ---
async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });

const ROLE = "IT project manager in Paris, mostly ERP";

describe("#16 discovery routes", () => {
  it("GET /onboarding/discovery before Q1 → the empty skeleton, on the anonymous session (no wall)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/discovery");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stage: "discovery", role: null, questions: [], cvLines: [] });
  });

  it("family lookup returns the family + kin titles; an empty query is silent", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const hit = (await get(app, cookie, "/onboarding/discovery/family?q=project%20manager")).json();
    expect(hit.family).toBe("IT Project Manager");
    expect(hit.suggestions.length).toBeGreaterThan(0);
    const empty = (await get(app, cookie, "/onboarding/discovery/family?q=")).json();
    expect(empty.suggestions).toEqual([]);
  });

  it("start seeds family/city/promise + the asked floor (essential+standard, no nice-to-have) + the role line", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const s: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(s).toMatchObject({ role: ROLE, family: "IT Project Manager", city: "Paris" });
    expect(s.promise).toMatchObject({ family: "IT Project Manager", city: "Paris", count: 142 });
    expect(s.essentialRemaining).toBe(3); // 3 essential items in the stub floor
    expect(s.questions.map((q) => q.itemId)).not.toContain("headline-focus"); // nice-to-have not asked
    expect(s.questions).toHaveLength(7); // 3 essential + 4 standard
    expect(s.cvLines[0]).toMatchObject({ itemId: "role", text: "IT project manager in Paris" });
  });

  it("a positive answer adds a CV line, advances its section bar + the countdown", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "budget-accountability",
        answer: "Yes, over $1M",
      })
    ).json();
    expect(s.cvLines.some((l) => l.itemId === "budget-accountability" && /over \$1M/.test(l.text))).toBe(true);
    expect(s.essentialRemaining).toBe(2); // one essential closed
    expect(s.railFill.experience).toBeGreaterThan(0);
    expect(s.questions.map((q) => q.itemId)).not.toContain("budget-accountability"); // never re-offered
  });

  it("a 'no' answer closes the item (advances the countdown) but adds no CV line — persisted as a negative", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "stakeholder-reporting",
        answer: "No",
      })
    ).json();
    expect(s.essentialRemaining).toBe(2); // the "no" still closed it
    expect(s.cvLines.some((l) => l.itemId === "stakeholder-reporting")).toBe(false); // no line for a "no"
    expect(s.questions.map((q) => q.itemId)).not.toContain("stakeholder-reporting");
    // persisted as a negative (the #13 write path), not a confirmed positive:
    const session = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = session.json().id as string;
    expect((await claims.negatives(sid)).map((c) => c.id)).toContain("discovery-stakeholder-reporting");
    expect((await claims.confirmed(sid)).map((c) => c.id)).not.toContain("discovery-stakeholder-reporting");
  });

  it("a hedged 'No, but …' answer is conserved as a CV line — never dropped as a negative (conservation)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "education-related-field",
        answer: "No, but a related certification",
      })
    ).json();
    // the qualification is a real fact → a positive CV line in its section, NOT a negative claim.
    expect(s.cvLines.some((l) => l.itemId === "education-related-field")).toBe(true);
    const session = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = session.json().id as string;
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain("discovery-education-related-field");
    expect((await claims.negatives(sid)).map((c) => c.id)).not.toContain("discovery-education-related-field");
  });

  it("answers persist server-side — a reload (fresh GET) resumes with the lines, not re-derived from the client", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "pm-certification", answer: "PMP" });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.role).toBe(ROLE);
    expect(resumed.cvLines.map((l) => l.itemId)).toEqual(["role", "budget-accountability", "pm-certification"]);
    expect(resumed.essentialRemaining).toBe(2);
  });

  it("an unknown itemId is a 404; an already-answered item is a 409 (never double-counted)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    expect((await post(app, cookie, "/onboarding/discovery/answer", { itemId: "nope", answer: "x" })).statusCode).toBe(404);
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    const dup = await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, under $1M" });
    expect(dup.statusCode).toBe(409);
  });

  it("answering before Q1 (no role) is a 409, not a write", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes" });
    expect(res.statusCode).toBe(409);
  });
});
