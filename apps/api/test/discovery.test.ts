// #16 discovery (screen 1a) — the pure line/family helpers + the discovery HTTP API (the spec's
// primary seam: every server-decided behaviour observed through the route). Prior art:
// onboarding.test.ts (real requests over the spine) and preview.test.ts (pure helpers).
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
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
  promiseCount,
  readerQuestion,
  resolveFamily,
  type DiscoveryState,
} from "../src/discovery.js";
import { ANY_FAMILY, PgEligibilityStore, type EligibilityStore } from "../src/eligibility.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";

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

  // #179: promiseCount is the ONE producer of the open-jobs number — the onboarding promise and
  // the profile rail both read it. It counts pool postings whose read-stamped familyFit names the
  // family; a family nothing is stamped for gets a real 0, never a hand number.
  it("#179: promiseCount counts read-stamped pool postings per family, 0 for an unstamped family", () => {
    expect(promiseCount("IT Project Manager")).toBe(10); // see the /start test's join note
    expect(promiseCount("Business Analysis")).toBe(0);
    expect(promiseCount("")).toBe(0);
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
    // #179: the count is real now — the postings in the live pool (sample-postings.json) whose
    // read-stamped familyFit (sample-ad-requirements.json, joined by adId) names this family.
    // 10 of the 17 pool postings carry a stamp today, all "IT Project Manager". If this fails
    // after a pool/fixture change, recount the join — never hand-tune the number back.
    expect(s.promise).toMatchObject({ family: "IT Project Manager", city: "Paris", count: 10 });
    expect(s.essentialRemaining).toBe(3); // 3 essential items in the stub floor
    expect(s.questions.map((q) => q.itemId)).not.toContain("headline-focus"); // nice-to-have not asked
    // #106 code-review must-fix 2: the 3 eligibility questions are visible from Q1 too, appended
    // after the 7 floor questions (never withheld until the essential band is covered).
    expect(s.questions).toHaveLength(10); // 3 essential + 4 standard + 3 eligibility
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
  // #106: the essential band alone no longer flips it — three eligibility questions are also due; see
  // the "#106 eligibility questions in discovery" describe block below for that gate on its own.
  it("answering the last essential item flips stage to deck only once eligibility is also closed; a fresh GET and the session both persist it", async () => {
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
    expect(last.essentialRemaining).toBe(0);
    expect(last.stage).toBe("discovery"); // #106: three eligibility questions are now pending
    const eligibilityIds = last.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligibilityIds).toHaveLength(3);

    let final: DiscoveryState = last;
    for (const itemId of eligibilityIds) {
      final = (await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })).json();
    }
    expect(final.stage).toBe("deck");

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
    expect(before.essentialRemaining).toBe(0); // essential band fully asked
    // #106: stage no longer flips to deck on the essential band alone — eligibility is now pending.
    expect(before.stage).toBe("discovery");
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

// --- #106 eligibility questions in discovery ------------------------------------------------
// Storage is eligibility.ts's (#86 decisions 4+5, already merged and tested — eligibility.test.ts).
// This drives the SAME three live routes as "#16 discovery routes" above; the derivation (which
// three dimensions, and why) is docs/research/eligibility-dimensions-from-the-corpus.md.
//
// 2026-08-03 code review folded in here: must-fix 1 (an affirmative answer must never reach the
// claim graph as a confirmed-gap node), must-fix 2 (eligibility questions visible from Q1, never
// withheld until the essential band is covered — the countdown must not climb back up), must-fix 3
// (a decline must not inflate factCount), must-fix 5 (correcting to a decline must retract the
// stored fact), must-fix 6 (the live years-experience scope must be a domain phrase, not the stub's
// job title), must-fix 8 (a decline's recorded text must name the real city the visitor was asked
// about).
describe("#106 eligibility questions in discovery", () => {
  it("an eligibility fact reads as unknown before it has ever been asked (#106 regression case)", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "years-experience", years.eligibility!.familyId)).toBeNull();
    expect(await eligibility.get(sid, "work-rights")).toBeNull();
    expect(await eligibility.get(sid, "language")).toBeNull();
  });

  it("appears in questions from Q1, positioned right after the essential band and before the standard one (must-fix 2, corrected in round 3)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.essentialRemaining).toBe(3); // essential band completely untouched
    expect(start.questions).toHaveLength(10); // 3 essential + 3 eligibility + 4 standard (untriggered)

    // Round 2 put eligibility after the WHOLE floor (essential+standard) — a funnel regression (round
    // 3): the ask dock renders questions[0] only, so a visitor had to clear the entire standard band
    // just to REACH the eligibility questions that gate the deck. Round 3's fix: eligibility slots in
    // between essential and standard, never after standard.
    const eligDimensions = start.questions.map((q) => q.eligibility?.dimension ?? null);
    expect(eligDimensions.slice(0, 3)).toEqual([null, null, null]); // the 3 essential items
    expect(eligDimensions.slice(3, 6)).toEqual(["years-experience", "work-rights", "language"]);
    expect(eligDimensions.slice(6)).toEqual([null, null, null, null]); // the 4 standard items, still last
  });

  // Code-review round 3, the regression QA flagged directly: pins the funnel length so this can't
  // silently regress again. Before #106, a visitor cleared the essential band alone (~3 answers) and
  // reached the deck; the standard band was always optional/loopback-reachable, never required.
  it("reaches the deck after the essential band + eligibility questions, WITHOUT ever being asked the standard band (funnel regression)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const eligIds = start.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligIds).toHaveLength(3);

    let state = start;
    for (const itemId of eligIds) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })).json();
    }
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, one team",
    });
    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" })
    ).json();

    expect(last.stage).toBe("deck"); // reached with only essential (3) + eligibility (3) = 6 answers
    // None of the standard band's items were ever answered — they were never required.
    const standardFloorIds = ["delivery-methodology", "pm-certification", "risk-register", "education-related-field"];
    for (const itemId of standardFloorIds) {
      expect(last.cvLines.some((l) => l.itemId === itemId)).toBe(false);
    }
  });

  it("does not enter essentialRemaining or railFill — the floor-only meaning is unchanged", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.some((q) => q.eligibility)).toBe(true); // they ARE present in questions

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const [confirmed, negatives] = await Promise.all([claims.confirmed(sid), claims.negatives(sid)]);
    // Same underlying (empty) floor answers, computed WITHOUT the eligibility layer — must match
    // exactly: three eligibility questions sitting in `questions` moved nothing.
    const floorOnly = discoveryState(ROLE, confirmed, negatives, []);
    expect(start.railFill).toEqual(floorOnly.railFill);
    expect(start.essentialRemaining).toBe(floorOnly.essentialRemaining);
  });

  it("stage flips to deck only once BOTH bands are closed, regardless of which finishes first (must-fix 2)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const eligIds = start.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligIds).toHaveLength(3);

    // Close every eligibility question FIRST, well before the essential band — legitimate under the
    // fix (they're always visible), and exactly the ordering the old withholding gate would have
    // broken the countdown on.
    let state = start;
    for (const itemId of eligIds) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })).json();
      expect(state.stage).toBe("discovery"); // essential band still fully open
    }

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
    const mid: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: "cross-functional-leadership",
        answer: "Yes, one team",
      })
    ).json();
    expect(mid.stage).toBe("discovery"); // one essential item still open

    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" })
    ).json();
    expect(last.stage).toBe("deck"); // both bands closed now, whichever order they closed in
  });

  it("a real value answer produces no CV line, closes the question, and lands in the eligibility store", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "5–7 years" })
    ).json();
    expect(answered.cvLines.some((l) => l.itemId === years.itemId)).toBe(false); // #106 AC7
    expect(answered.questions.map((q) => q.itemId)).not.toContain(years.itemId); // closed, never re-offered

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const fact = await eligibility.get(sid, "years-experience", years.eligibility!.familyId);
    expect(fact).toMatchObject({ value: "5" }); // #106: the band's lower bound, never a midpoint
  });

  // Code-review must-fix 1: the oracle (packages/contracts/oracle/validate_graph.mjs) defines a
  // Negative-classified graph node as a CONFIRMED GAP Tailor must never assert. graph.ts's
  // buildClaimGraph only ever sees claims.confirmed()/claims.negatives() as input (no other source) —
  // so proving an affirmative answer is absent from BOTH buckets proves it is structurally impossible
  // for it to reach the graph at all, renderable or not. Neither /onboarding/build's response nor any
  // other route exposes the graph's raw node list, so the claims store — the graph's only input — is
  // the strongest check available at the API boundary.
  it("an affirmative eligibility answer never enters the claims store, so it can never reach the graph as a confirmed-gap node (must-fix 1)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Yes — no sponsorship needed",
    });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "5–7 years" });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const [confirmed, negatives] = await Promise.all([claims.confirmed(sid), claims.negatives(sid)]);
    const allIds = [...confirmed, ...negatives].map((c) => c.id);
    expect(allIds).not.toContain(discoveryClaimId(workRights.itemId));
    expect(allIds).not.toContain(discoveryClaimId(years.itemId));
  });

  it("declining does not inflate factCount — a refusal is not a recorded fact (must-fix 3)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    const after: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION })
    ).json();
    expect(after.factCount).toBe(start.factCount);
  });

  it("declining stores NO fact — the dimension still reads as unknown, distinct from a real answer", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION })
    ).json();
    expect(answered.questions.map((q) => q.itemId)).not.toContain(workRights.itemId); // closed — never re-asked
    expect(answered.cvLines.some((l) => l.itemId === workRights.itemId)).toBe(false);

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights")).toBeNull(); // unknown, never "does not have it"
  });

  it("an explicit negative answer IS a real value, stored through the existing store — distinct from a decline and from unknown", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Not yet — I'd need sponsorship",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // #182: stored at the SLUG of the city the question was about (ROLE names Paris), not the old
    // global scope, and never the raw display string (QA round 3 must-fix: kebab slug, not "Paris").
    expect(await eligibility.get(sid, "work-rights", "paris")).toMatchObject({ value: "needs-sponsorship" });
  });

  // Code-review must-fix 5: correcting TO a decline must retract a prior real answer's stored value —
  // eligibility.remove() exists and was unused. Without this, slice 6 (#107) would withdraw jobs on
  // an answer the visitor explicitly retracted, while the screen tells them nobody knows.
  it("correcting a real answer TO a decline retracts the stored fact (must-fix 5)", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Not yet — I'd need sponsorship",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // #182: stored at the SLUG of the city the question was about (ROLE names Paris).
    expect(await eligibility.get(sid, "work-rights", "paris")).toMatchObject({ value: "needs-sponsorship" }); // stored

    const corrected: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION })
    ).json();
    expect(corrected.questions.map((q) => q.itemId)).not.toContain(workRights.itemId); // still closed
    expect(await eligibility.get(sid, "work-rights", "paris")).toBeNull(); // retracted, not stale
  });

  it("re-answering an eligibility question corrects it, exactly like the existing idempotent upsert", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "Under 3 years" });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "More than 10 years" });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.numeric(sid, "years-experience", years.eligibility!.familyId)).toBe(10);
  });

  it("years-experience is scoped to the resolved family — the global scope stays empty", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;
    expect(years.eligibility!.familyId).not.toBe(ANY_FAMILY);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "5–7 years" });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.numeric(sid, "years-experience")).toBeNull(); // the global scope stays empty
    expect(await eligibility.numeric(sid, "years-experience", years.eligibility!.familyId)).toBe(5);
  });

  // Code-review must-fix 6: a job title ("...worked in IT Project Manager?") is ungrammatical and
  // misreads as the wrong thing — the ticket's central UX requirement is that the scope be tellable
  // from the question alone, on the path that actually runs (the E5 stub — nothing pins a production
  // floor via the live routes today).
  it("the live path's years-experience question uses a domain phrase, not the stub's job title (must-fix 6)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;
    expect(years.question).toBe("How many years have you worked in IT project delivery?");
    expect(years.eligibility!.scopeLabel).toBe("IT project delivery");
    expect(years.question).not.toContain("IT Project Manager");
  });

  // Code-review must-fix 8: the decline's recorded text rebuilds the question, so it must reflect the
  // CITY THE VISITOR WAS ACTUALLY ASKED ABOUT, not a generic placeholder.
  it("a work-rights decline records the real city the visitor was asked about, not a placeholder (must-fix 8)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json(); // ROLE names Paris
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    expect(workRights.question).toBe("Can you already work in Paris without visa sponsorship?");

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const negatives = await claims.negatives(sid);
    const declineClaim = negatives.find((c) => c.id === discoveryClaimId(workRights.itemId))!;
    expect(declineClaim.text).toContain("Paris");
    expect(declineClaim.text).not.toContain("where you're job-hunting"); // the generic fallback text
  });

  // #182 QA round 3, MUST-FIX: a multi-word city ("Hong Kong") used to reach the decline's claim id
  // raw ("discovery-eligibility-work-rights-Hong Kong") — a space and a capital, both illegal in
  // ClaimGraph's kebab-slug id contract — so /onboarding/build looped back with "id must be a kebab
  // slug" the moment a visitor declined work-rights while job-hunting in a two-word city. The key is
  // now slug(city) ("hong-kong"), never the raw display string.
  it("#182 QA round 3: a decline in a MULTI-WORD city produces a valid kebab-slug claim id and /onboarding/build reaches ready", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "qa182-multiword@example.com");
    const start: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager in Hong Kong" })
    ).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const negatives = await claims.negatives(sid);
    const declineClaim = negatives.find((c) => c.id === discoveryClaimId(workRights.itemId))!;
    const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    expect(KEBAB_SLUG.test(declineClaim.id)).toBe(true);

    // Build needs at least one confirmed fact to leave `loopback` — seed one directly (this test's
    // subject is the DECLINE's claim id, not the mine pipeline).
    await claims.add(sid, {
      id: "qa-seed-claim",
      semantic_key: "qa-seed-claim",
      field_key: null,
      field_value: null,
      field_label: null,
      role: "profile",
      text: "Delivered projects.",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "Delivered projects.",
      needs_grill: false,
      grill_hint: null,
    });
    const built = await post(app, cookie, "/onboarding/build", undefined);
    const body = built.json();
    expect(body.stage).toBe("ready");
    expect(body.gate).toEqual({ ok: true, errors: [] });
  });

  // #182 QA round 3 must-fix: case and whitespace variants of ONE city must land on the SAME market
  // key — "in HONG KONG" and "in Hong  Kong" (double space) used to split into different itemIds
  // (and so different store keys), and an all-lowercase "in hong kong" used to match parseCity's old
  // regex NOT AT ALL, silently storing the answer at the global ANY_FAMILY scope instead of a market.
  it("#182 QA round 3: case and whitespace variants of one city resolve to the SAME work-rights market key", async () => {
    const { app } = buildServer();
    const itemIdFor = async (role: string) => {
      const cookie = await anonSession(app);
      const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role })).json();
      return start.questions.find((q) => q.eligibility?.dimension === "work-rights")!.itemId;
    };
    const ids = await Promise.all(
      [
        "IT project manager in Hong Kong",
        "IT project manager in hong kong",
        "IT project manager in HONG KONG",
        "IT project manager in  Hong  Kong",
        "IT project manager in Hong kong",
      ].map(itemIdFor),
    );
    expect(new Set(ids).size).toBe(1); // every variant is the SAME market key
    expect(ids[0]).not.toBe("eligibility-work-rights-*"); // the lowercase variant found a real city, not ANY_FAMILY
  });

  it("an unknown eligibility itemId is a 404", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const res = await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "eligibility-not-a-real-dimension",
      answer: "x",
    });
    expect(res.statusCode).toBe(404);
  });

  it("an unrecognized answer for a known eligibility item is a 400, never a crash", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;
    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "about 8 years" });
    expect(res.statusCode).toBe(400);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // The store's own write-time guard (assertStorable) is never even reached with a bad value.
    expect(await eligibility.get(sid, "years-experience", years.eligibility!.familyId)).toBeNull();
  });

  it("resumes identically on a fresh GET — the whole screen stays a pure function of persisted state", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;
    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "5–7 years" })
    ).json();

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.questions.map((q) => q.itemId)).toEqual(answered.questions.map((q) => q.itemId));
    expect(resumed.stage).toBe(answered.stage);
  });

  // Store contract seam, both drivers (prior art: eligibility.test.ts) — proves THIS module's wiring
  // (not just the store in isolation) is driver-agnostic, injecting the pg-mem-backed driver the same
  // way eligibility.test.ts's own dual-driver loop does.
  it("a structured fact survives a round trip through the Postgres driver too (pg-mem)", async () => {
    const { Pool } = newDb().adapters.createPg();
    const eligibility: EligibilityStore = new PgEligibilityStore(new Pool());
    await eligibility.init();
    const { app } = buildServer({ eligibility });
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const years = start.questions.find((q) => q.eligibility?.dimension === "years-experience")!;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: years.itemId, answer: "8–10 years" });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.numeric(sid, "years-experience", years.eligibility!.familyId)).toBe(8);
  });
});

// --- #123 the languages question — a multi-select question that arms #107's withdrawal engine -----
// Supersedes the old single-English question tested above (#106's "Can you work professionally in
// English?"). Driven entirely through the same two seams spec #86 pins: the HTTP route and the store
// contract — never a private function, never a branch assertion. AC-level withdrawal-through-the-deck
// coverage (AC1-AC4, AC6) lives in cards.test.ts's own "#123" block, reusing #107's mandarinBlocking/
// mandarinAdvantage fixtures; this block covers the question's shape and the answer route's own
// write/decline/correction/validation behaviour.
describe("#123 the languages question", () => {
  const languageQuestion = (start: DiscoveryState) =>
    start.questions.find((q) => q.eligibility?.dimension === "language")!;

  it("is a multi-select over the pinned four-language list, with the pinned copy and itemId (AC5, AC7)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const language = languageQuestion(start);

    expect(language.itemId).toBe("eligibility-languages");
    expect(language.multiSelect).toBe(true);
    expect(language.question).toBe(
      "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.",
    );
    // Code-review must-fix 1 (2026-08-04), trimmed by owner correction (2026-08-04): the pinned
    // first sentence is intact; the second is an added, recorded deviation (see
    // eligibilityDiscovery.ts's LANGUAGES_CONSEQUENCE doc) biasing an unsure visitor toward ticking,
    // since a binary multi-select can no longer produce a "some, but not for work" answer. Trimmed to
    // a three-word nudge after QA flagged the first draft as the longest thing on screen.
    expect(language.consequence).toBe(
      "A no takes jobs that require that language out of your deck. Tick every one you could run a meeting in." +
        " Not sure? Tick it.",
    );
    expect(language.options).toEqual(["English", "Mandarin", "Cantonese", "Vietnamese", DECLINE_OPTION]);
  });

  it("the option order is stable across separate sessions — never re-sorted between requests", async () => {
    const { app } = buildServer();
    const cookieA = await anonSession(app);
    const cookieB = await anonSession(app);
    const startA: DiscoveryState = (await post(app, cookieA, "/onboarding/discovery/start", { role: ROLE })).json();
    const startB: DiscoveryState = (await post(app, cookieB, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(languageQuestion(startA).options).toEqual(languageQuestion(startB).options);
  });

  it("AC1: a real multi-select answer stores more than one language, and writes the FULL list — every unticked language becomes an explicit 'no'", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Cantonese"] });

    expect(await eligibility.get(sid, "language", "English")).toMatchObject({ value: "professional" });
    expect(await eligibility.get(sid, "language", "Cantonese")).toMatchObject({ value: "professional" });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "none" });
    expect(await eligibility.get(sid, "language", "Vietnamese")).toMatchObject({ value: "none" });
  });

  it("answers: [] is a legal answer — every language is stored as an explicit 'no', and the question closes", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: [] })
    ).json();
    expect(answered.questions.some((q) => q.itemId === itemId)).toBe(false); // closed, never re-offered
    expect(await eligibility.get(sid, "language", "English")).toMatchObject({ value: "none" });
  });

  it("a real answer never reaches the claims store (must-fix 1, unchanged by #123)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English"] });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const [confirmed, negatives] = await Promise.all([claims.confirmed(sid), claims.negatives(sid)]);
    expect([...confirmed, ...negatives].map((c) => c.id)).not.toContain(discoveryClaimId(itemId));
  });

  it("the question is answered iff at least one language fact exists — resumes closed on a fresh GET", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["Vietnamese"] });
    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.questions.some((q) => q.itemId === itemId)).toBe(false);
  });

  it("AC6: re-answering corrects every language's stored value — a previously-'no' language flips to 'professional'", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "none" });

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Mandarin"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "professional" });
  });

  it("declining retracts every previously-stored language fact (must-fix 5, applied to the whole list)", async () => {
    const { app, eligibility, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Mandarin"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "professional" });

    const declined: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })
    ).json();
    expect(declined.questions.some((q) => q.itemId === itemId)).toBe(false); // still closed
    for (const language of ["English", "Mandarin", "Cantonese", "Vietnamese"]) {
      expect(await eligibility.get(sid, "language", language)).toBeNull(); // retracted, not stale
    }
    const negatives = await claims.negatives(sid);
    expect(negatives.some((c) => c.id === discoveryClaimId(itemId))).toBe(true);
  });

  // Code-review must-fix 2 (2026-08-04): languages-by-market.json is the owner's own hand-edit
  // surface (must-fix 4) and can shrink or rename entries. A decline must retract a fact stored at a
  // scope TODAY's list no longer contains — looping languagesUnion() (the pre-fix bug) would silently
  // leave it behind, since eligibility.remove() has no "clear every scope" call. Seeds a fact at a
  // scope outside today's union directly (standing in for a market dropped/renamed since the visitor
  // answered) to prove the decline path reads what's ACTUALLY stored, not today's list.
  it("declining retracts a language fact even at a scope outside TODAY's supported list (must-fix 2)", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    // A fact at a scope the CURRENT languages-by-market.json no longer lists — e.g. a market dropped
    // or a language renamed after the visitor answered.
    await eligibility.put(sid, { dimension: "language", familyId: "Lao", value: "professional", label: "x" });
    expect(await eligibility.get(sid, "language", "Lao")).not.toBeNull();

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION });
    expect(await eligibility.get(sid, "language", "Lao")).toBeNull(); // retracted, not left stale
  });

  it("an answers array containing a language outside the list is a 400 invalid_answer, never silently stored", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["Klingon"] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "invalid_answer" } });
    expect(await eligibility.get(sid, "language", "English")).toBeNull(); // never partially written
  });

  it("a single free-text `answer` (not the decline string) sent to the multi-select question is a 400, never a silent fall-through", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;

    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: "Yes" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "invalid_answer" } });
  });

  it("sending both answer and answers, or neither, is a 400 invalid_answer", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;

    const both = await post(app, cookie, "/onboarding/discovery/answer", {
      itemId,
      answer: "English",
      answers: ["English"],
    });
    expect(both.statusCode).toBe(400);
    expect(both.json()).toMatchObject({ error: { code: "invalid_answer" } });

    const neither = await post(app, cookie, "/onboarding/discovery/answer", { itemId });
    expect(neither.statusCode).toBe(400);
    expect(neither.json()).toMatchObject({ error: { code: "invalid_answer" } });
  });

  // The property that makes the language list safe to grow later (owner requirement, mid-build):
  // a visitor who answered under TODAY's list has no fact for a language outside it, which reads as
  // unknown — never a "no" — exactly like any other never-asked scope (withdrawal.ts's own rule).
  it("a language outside today's supported list has no fact after a real answer — safe to grow the list later", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId,
      answers: ["English", "Mandarin", "Cantonese", "Vietnamese"],
    });
    // "Lao" isn't in today's list — a future market addition — so no fact was ever written for it.
    expect(await eligibility.get(sid, "language", "Lao")).toBeNull();
  });
});
