// #16 discovery (screen 1a) — the pure line/family helpers + the discovery HTTP API (the spec's
// primary seam: every server-decided behaviour observed through the route). Prior art:
// onboarding.test.ts (real requests over the spine) and preview.test.ts (pure helpers).
import { describe, expect, it } from "vitest";
import type { FloorItem } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import type { ClaimRecord } from "../src/claims.js";
import {
  composeCvLine,
  composeRoleLine,
  discoveryClaimId,
  discoveryState,
  factCount,
  isNoAnswer,
  parseCity,
  readerQuestion,
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

// #18 — a discovery answer ClaimRecord, keyed by discoveryClaimId(itemId) as the routes persist it.
// Which array (confirmed vs negatives) it's passed in is what discoveryState reads, not `decision`.
const discoveryClaim = (itemId: string, over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  id: `discovery-${itemId}`,
  role: "profile",
  text: `${itemId} answered`,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "answer",
  needs_grill: false,
  grill_hint: null,
  decision: "confirmed",
  origin: "user-authored",
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
    expect(s.factCount).toBe(0);
  });

  // #17 profile badge / #23 factCount — "the pile that only grows": confirmed positives + persisted
  // negatives, a "no" counted just like a "yes". Pure-function seam directly (route coverage below).
  describe("factCount", () => {
    it("counts confirmed positives + persisted negatives", () => {
      expect(factCount([], [])).toBe(0);
      expect(factCount([discoveryClaim("a")], [])).toBe(1);
      expect(factCount([], [discoveryClaim("b")])).toBe(1);
      expect(factCount([discoveryClaim("a")], [discoveryClaim("b")])).toBe(2);
    });

    it("never decreases when a claim moves between the confirmed and negative buckets (a correction)", () => {
      const before = factCount([discoveryClaim("a")], []); // "a" answered positively
      const afterCorrection = factCount([], [discoveryClaim("a")]); // corrected to a "no" — same record, new bucket
      expect(afterCorrection).toBeGreaterThanOrEqual(before);
    });
  });

  // #18 AC1 — the gate: stage flips to "deck" only once the essential band is fully asked (not
  // necessarily satisfied — a "no" closes an essential item exactly like a "yes").
  it("discoveryState.stage is 'discovery' while any essential item is unanswered, 'deck' once all three are asked", () => {
    const role = "IT project manager in Paris";
    const partial = discoveryState(
      role,
      [discoveryClaim("budget-accountability"), discoveryClaim("cross-functional-leadership")],
      [],
    );
    expect(partial.stage).toBe("discovery");
    expect(partial.essentialRemaining).toBe(1);

    // The third essential item closed by a bare "no" — still "not necessarily satisfied" per AC1.
    const done = discoveryState(
      role,
      [discoveryClaim("budget-accountability"), discoveryClaim("cross-functional-leadership")],
      [discoveryClaim("stakeholder-reporting")],
    );
    expect(done.stage).toBe("deck");
    expect(done.essentialRemaining).toBe(0);
  });

  // #35 — a claim rejected in the S2 deck still closes its question (the visitor answered it; only
  // the machine's phrasing was rejected), but must not behave like a positive: no CV line, and no
  // trigger surfacing (isTriggered keys off confirmed positives only).
  it("a rejected claim closes its question (never re-asked) but contributes no CV line and no trigger", () => {
    const role = "IT project manager in Paris";
    const rejected = discoveryState(
      role,
      [discoveryClaim("cross-functional-leadership")],
      [],
      [discoveryClaim("budget-accountability")],
    );
    expect(rejected.essentialRemaining).toBe(1); // budget-accountability + cross-functional both closed
    expect(rejected.questions.map((q) => q.itemId)).not.toContain("budget-accountability");
    expect(rejected.cvLines.some((l) => l.itemId === "budget-accountability")).toBe(false);
    // A rejected trigger answer does not surface the item it would otherwise have triggered.
    expect(rejected.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");
  });

  // #18 AC5 — a triggered item is gated out of both questions and railFill until its trigger fires
  // POSITIVELY; a "no" on the trigger leaves it un-surfaced.
  it("a triggered item is excluded from questions/railFill until its trigger is answered POSITIVELY", () => {
    const role = "IT project manager in Paris";
    const untriggered = discoveryState(role, [], []);
    expect(untriggered.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");

    const noOnTrigger = discoveryState(role, [], [discoveryClaim("budget-accountability")]);
    expect(noOnTrigger.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");

    const yesOnTrigger = discoveryState(role, [discoveryClaim("budget-accountability")], []);
    expect(yesOnTrigger.questions.map((q) => q.itemId)).toContain("budget-employer-dates");
    // Surfaced but unanswered → counts against railFill's denominator, not its numerator.
    const beforeCount = untriggered.railFill.experience;
    expect(yesOnTrigger.railFill.experience).not.toBe(beforeCount);
  });

  it("readerQuestion (#18 AC6) derives a deterministic, free-text question from a mined role", () => {
    const q = readerQuestion({
      employer: "Acme",
      title: "Senior Consultant",
      dates_as_written: "2020-2022",
      dates_missing: false,
    });
    expect(q).toMatchObject({ itemId: "reader-role", options: [], cvSection: "experience" });
    expect(q.question).toContain("Senior Consultant");
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

// #35's route test needs a signed-in session — the reject route is post-wall (requireUser). Prior
// art: tailor.test.ts's own signIn helper.
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

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
    expect(s.factCount).toBe(1); // #17/#23: one recorded answer so far
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

  it("an unknown itemId is a 404; re-answering an already-answered item is idempotent, not a 409 (#18 AC4)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    expect((await post(app, cookie, "/onboarding/discovery/answer", { itemId: "nope", answer: "x" })).statusCode).toBe(404);
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    const corrected: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, under $1M" })
    ).json();
    expect(corrected.essentialRemaining).toBe(2); // still closed once — not double-counted
    expect(corrected.cvLines.find((l) => l.itemId === "budget-accountability")?.text).toMatch(/under \$1M/);
  });

  it("answering before Q1 (no role) is a 409, not a write", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes" });
    expect(res.statusCode).toBe(409);
  });

  // #18 AC1 — the gate: the last essential item answered flips stage to "deck", and it's PERSISTED
  // (a fresh GET, and the session's own stage, both read "deck" — not just the one response).
  it("answering the last essential item flips stage to deck; a fresh GET and the session both persist it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    const mid: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "cross-functional-leadership",
        answer: "Yes, one team",
      })
    ).json();
    expect(mid.stage).toBe("discovery"); // one essential item still open

    // The last essential item — closed by a bare "no" ("not necessarily satisfied", AC1's own wording).
    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" })
    ).json();
    expect(last.stage).toBe("deck");

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.stage).toBe("deck");
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("deck");
  });

  // #18 AC2/AC3 — a "no" leaves the item out of `questions`, and a completely fresh GET (simulating
  // the visitor returning later) still omits it: never re-asked.
  it("a 'no' leaves the item out of questions; a fresh GET (resume) still omits it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "risk-register", answer: "No" });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.questions.map((q) => q.itemId)).not.toContain("risk-register");
    expect(resumed.cvLines.some((l) => l.itemId === "risk-register")).toBe(false);
  });

  // #18 AC4 — correction, both directions: an accidental "no" fixed to a real "yes,…" gains a CV
  // line; a real "yes" corrected to a bare "no" loses it. Same idempotent route both ways.
  it("correcting an answer flips it: no→yes gains a CV line, yes→no drops it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "pm-certification", answer: "No" });
    const fixed: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "pm-certification", answer: "PMP" })
    ).json();
    expect(fixed.cvLines.find((l) => l.itemId === "pm-certification")?.text).toMatch(/PMP/);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "risk-register", answer: "Yes" });
    const reverted: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "risk-register", answer: "No" })
    ).json();
    expect(reverted.cvLines.some((l) => l.itemId === "risk-register")).toBe(false);
  });

  // #18 AC5 — the triggered item stays out of `questions` until its trigger is answered POSITIVELY;
  // a "no" on the trigger does not surface it. Once surfaced and answered, it's a normal CV line.
  it("a 'no' on the trigger does not surface the triggered item", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");

    const noTrigger: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "No" })
    ).json();
    expect(noTrigger.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");
  });

  it("a positive on the trigger surfaces the triggered item; answering it lands a CV line and closes it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    const yesTrigger: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "budget-accountability",
        answer: "Yes, over $1M",
      })
    ).json();
    expect(yesTrigger.questions.map((q) => q.itemId)).toContain("budget-employer-dates");

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "budget-employer-dates",
        answer: "Acme Corp, around 2021",
      })
    ).json();
    expect(answered.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");
    expect(answered.cvLines.find((l) => l.itemId === "budget-employer-dates")?.text).toMatch(/Acme Corp/);
  });

  // #18 AC6 — the reader-only question: a job with mined roles, owned by this session, gets ONE
  // synthetic free-text question prepended; answering it is a normal CV line and it's never re-asked.
  it("GET ?job= with mined roles prepends the ONE reader-only question; answering it is a CV line, never re-asked", async () => {
    const { app, store } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sessionId = me.json().id as string;
    const job = await store.create("onboarding", sessionId);
    await store.update(job.id, {
      progress: {
        miner: {
          doc: {
            roles: [
              { employer: "Acme", title: "Senior Consultant", dates_as_written: "2020-2022", dates_missing: false },
            ],
          },
        },
      },
    });

    const withReader: DiscoveryState = (await get(app, cookie, `/onboarding/discovery?job=${job.id}`)).json();
    expect(withReader.questions[0]).toMatchObject({ itemId: "reader-role", options: [] });
    expect(withReader.questions[0]!.question).toContain("Senior Consultant");

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "reader-role",
        answer: "Actually I was the interim delivery lead",
      })
    ).json();
    expect(
      answered.cvLines.some((l) => l.itemId === "reader-role" && /interim delivery lead/.test(l.text)),
    ).toBe(true);

    // Never re-asked: a fresh GET with the same ?job= omits it once answered.
    const again: DiscoveryState = (await get(app, cookie, `/onboarding/discovery?job=${job.id}`)).json();
    expect(again.questions.map((q) => q.itemId)).not.toContain("reader-role");
  });

  it("an unknown or foreign ?job= is silently ignored — never errors, no reader question", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const res = await get(app, cookie, "/onboarding/discovery?job=does-not-exist");
    expect(res.statusCode).toBe(200);
    expect((res.json() as DiscoveryState).questions.map((q) => q.itemId)).not.toContain("reader-role");
  });

  // #35 — a claim rejected in the S2 review deck must not reopen its discovery question: the visitor
  // was asked and answered, only the machine's phrasing of the claim was rejected. Prior art: exactly
  // the reproduction #33's tailor.test.ts route test performs (reject discovery-budget-accountability,
  // re-read) — reused here to prove the derivation itself never regresses, not just the factCount floor.
  it("a claim rejected in the S2 deck does not reopen its discovery question, and railFill/essentialRemaining never regress (#35)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, multiple teams",
    });
    const before: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" })
    ).json();
    expect(before.stage).toBe("deck"); // essential band fully asked
    expect(before.essentialRemaining).toBe(0);
    const railBefore = before.railFill.experience;

    // The reject route is post-wall (requireUser) — sign in, like #33's own route test does.
    await signIn(app, cookie, "reject-reopens@example.com");
    const rejectRes = await app.inject({
      method: "POST",
      url: `/onboarding/claims/${discoveryClaimId("budget-accountability")}/reject`,
      headers: { cookie },
    });
    expect(rejectRes.statusCode).toBe(200);

    const after: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    // AC1: the question does not come back.
    expect(after.questions.map((q) => q.itemId)).not.toContain("budget-accountability");
    // AC2: railFill for that section never decreases. Pinned to the literal as well as the AC's own
    // >= shape: a bare >= also passes when the value RISES because the denominator shrank (askable
    // losing an item), which is the failure mode the sibling trigger test below exists to catch.
    expect(railBefore).toBe(0.6);
    expect(after.railFill.experience).toBe(0.75);
    expect(after.railFill.experience).toBeGreaterThanOrEqual(railBefore);
    // AC3: essentialRemaining never increases.
    expect(after.essentialRemaining).toBeLessThanOrEqual(before.essentialRemaining);
  });

  // Review fix (both axes): rejecting a TRIGGER claim must not evict its already-answered follow-up
  // from railFill's denominator — isTriggered keyed off `positives` alone (pre-fix) loses the trigger
  // the moment the claim moves out of `confirmed`, and "un-surfacing" an already-answered item shrinks
  // BOTH numerator and denominator, which can mask a regression behind toBeGreaterThanOrEqual. Pin the
  // literal value (0.4 both times), not just "not decreased".
  it("rejecting a trigger claim does not evict its already-answered triggered follow-up from railFill (#35)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    const before: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "budget-employer-dates",
        answer: "Acme Corp, around 2021",
      })
    ).json();
    expect(before.railFill.experience).toBe(0.4); // 2 of 5 askable experience items answered

    await signIn(app, cookie, "reject-trigger@example.com");
    const rejectRes = await app.inject({
      method: "POST",
      url: `/onboarding/claims/${discoveryClaimId("budget-accountability")}/reject`,
      headers: { cookie },
    });
    expect(rejectRes.statusCode).toBe(200);

    const after: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(after.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates"); // still not re-asked
    expect(after.railFill.experience).toBe(0.4); // unchanged, not just non-decreasing
  });

  // Review fix (Spec axis): the reader-only question (#18 AC6) has its own answered-check independent
  // of discoveryState's answeredIds — it must also treat a deck-rejected claim as answered, or the
  // same never-re-ask guarantee breaks one function call away from the fix above.
  it("a deck-rejected reader-only claim does not reopen the reader question (#35)", async () => {
    const { app, store } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sessionId = me.json().id as string;
    const job = await store.create("onboarding", sessionId);
    await store.update(job.id, {
      progress: {
        miner: {
          doc: {
            roles: [
              { employer: "Acme", title: "Senior Consultant", dates_as_written: "2020-2022", dates_missing: false },
            ],
          },
        },
      },
    });

    await get(app, cookie, `/onboarding/discovery?job=${job.id}`); // surfaces the reader question
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "reader-role",
      answer: "Actually I was the interim delivery lead",
    });

    await signIn(app, cookie, "reject-reader-role@example.com");
    const rejectRes = await app.inject({
      method: "POST",
      url: `/onboarding/claims/${discoveryClaimId("reader-role")}/reject`,
      headers: { cookie },
    });
    expect(rejectRes.statusCode).toBe(200);

    const after: DiscoveryState = (await get(app, cookie, `/onboarding/discovery?job=${job.id}`)).json();
    expect(after.questions.map((q) => q.itemId)).not.toContain("reader-role");
  });
});
