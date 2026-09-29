// #16 discovery (screen 1a) — the pure line/family helpers + the discovery HTTP API (the spec's
// primary seam: every server-decided behaviour observed through the route). Prior art:
// onboarding.test.ts (real requests over the spine) and preview.test.ts (pure helpers).
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { FloorItem, PostingRetrievalResultV1 } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer, IT_PROJECT_DELIVERY_PLACEMENT } from "./placedServer.js";
import { fixturePostingsV1, fixtureRetriever } from "./fixtureDeck.js";
import {
  eligiblePostings,
  loadPostings,
  retrievedPostingCount,
  retrievedPostings,
} from "../src/preview.js";
import type { ClaimRecord } from "../src/claims.js";
import {
  composeCvLine,
  composeRoleLine,
  type DiscoveryFamily,
  discoveryClaimId,
  discoveryState,
  factCount,
  isNoAnswer,
  parseCity,
  readerQuestion,
  slug,
  type DiscoveryState,
} from "../src/discovery.js";
import { ANY_FAMILY, PgEligibilityStore, type EligibilityStore } from "../src/eligibility.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";
import { answerLanguageLevel } from "../src/languageLevel.js";
import { initialProductionFamilyFloors, productionDiscoveryFamily } from "../src/familyFloors.js";

const item = (over: Partial<FloorItem>): FloorItem => ({
  id: "x",
  rankBand: "essential",
  question: "Have you owned a project budget?",
  options: ["Yes, over $1M", "Yes, under $1M", "No"],
  cvSection: "experience",
  noIsFatal: true,
  ...over,
});

const PURE_DISCOVERY_FAMILY: DiscoveryFamily = {
  label: "IT project delivery",
  familyId: "it-project-delivery",
  suggestions: [],
  items: [
    item({ id: "budget-accountability" }),
    item({ id: "cross-functional-leadership", question: "Have you led a cross-functional or vendor team?" }),
    item({
      id: "stakeholder-reporting",
      question: "Have you reported project status to senior stakeholders or a steering committee?",
    }),
    item({
      id: "budget-employer-dates",
      rankBand: "standard",
      question: "Nice — which job was that, and roughly when?",
      options: [],
      noIsFatal: false,
      triggeredBy: "budget-accountability",
    }),
  ],
};

// #255: the registry holds more than one family now, so tests that mean a SPECIFIC family pin it
// by reference — the no-references default is only the deterministic first family, not "the" one.
const PRODUCTION_DISCOVERY_FAMILY = productionDiscoveryFamily(initialProductionFamilyFloors(), [
  { familyId: "it-project-delivery", version: 2 },
])!;

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

  it("productionDiscoveryFamily reads the active registry family and market titles", () => {
    expect(PRODUCTION_DISCOVERY_FAMILY).toMatchObject({
      familyId: "it-project-delivery",
      label: "IT Project Manager",
    });
    expect(PRODUCTION_DISCOVERY_FAMILY.items.map((floorItem) => floorItem.id)).toEqual([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]);
    expect(PRODUCTION_DISCOVERY_FAMILY.suggestions).toEqual(["project manager", "delivery manager"]);
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
      [],
      null,
      PURE_DISCOVERY_FAMILY,
    );
    expect(partial.stage).toBe("discovery");
    expect(partial.essentialRemaining).toBe(1);

    // The third essential item closed by a bare "no" — still "not necessarily satisfied" per AC1.
    const done = discoveryState(
      role,
      [discoveryClaim("budget-accountability"), discoveryClaim("cross-functional-leadership")],
      [discoveryClaim("stakeholder-reporting")],
      [],
      null,
      PURE_DISCOVERY_FAMILY,
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
      null,
      PURE_DISCOVERY_FAMILY,
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
    const untriggered = discoveryState(role, [], [], [], null, PURE_DISCOVERY_FAMILY);
    expect(untriggered.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");

    const noOnTrigger = discoveryState(role, [], [discoveryClaim("budget-accountability")], [], null, PURE_DISCOVERY_FAMILY);
    expect(noOnTrigger.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");

    const yesOnTrigger = discoveryState(role, [discoveryClaim("budget-accountability")], [], [], null, PURE_DISCOVERY_FAMILY);
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
// #184 — /sessions/me/intent is PUT, not POST.
const put = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "PUT", url, headers: { cookie }, payload });

// #35's route test needs a signed-in session — the reject route is post-wall (requireUser). Prior
// art: tailor.test.ts's own signIn helper.
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

const ROLE = "IT project manager in Paris, mostly ERP";
const END_TO_END = "end-to-end-delivery";
const STAKEHOLDERS = "stakeholder-coordination";
const RISKS = "risk-dependency-control";
const COMMUNICATION = "delivery-communication";

describe("#16 discovery routes", () => {
  it("GET /onboarding/discovery before Q1 → the empty skeleton, on the anonymous session (no wall)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/discovery");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stage: "discovery", role: null, questions: [], cvLines: [] });
  });

  // #246: the promise's number is what HER OWN search returned, read off the retrieval result and
  // nothing else. #179's promiseCount — which counted rows in the fixture pool whose read-stamped
  // familyFit named the family she is INTERVIEWED on — is gone: for a word-search visitor that is
  // not the family her deck searches, so it stated a count the deck could never keep.
  it("#246: the count is the retrieval's own pool, through the language gate", () => {
    const langs = ["en"];
    const postings = fixturePostingsV1(loadPostings());
    const found: PostingRetrievalResultV1 = {
      schemaVersion: "5",
      outcome: "relevant_postings",
      postings,
      coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
      retrievedAt: new Date().toISOString(),
    };
    // 16, not the 17 rows on disk: one advert is not in a language this reader can read, and the
    // deck applies that same gate — a promise counting it would over-promise by exactly one card.
    expect(retrievedPostingCount(found, langs)).toBe(16);
    expect(eligiblePostings(langs, retrievedPostings(found))).toHaveLength(16);
    // Every not-a-completed-search outcome is null — "we could not look", never a fabricated 0.
    for (const outcome of ["empty_pool", "provider_unavailable", "stale_data", "invalid_request"] as const) {
      expect(retrievedPostingCount({ ...found, outcome } as PostingRetrievalResultV1, langs)).toBeNull();
    }
    expect(retrievedPostingCount(null, langs)).toBeNull();
  });

  it("family lookup returns the active production family + market titles; an empty query is silent", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const hit = (await get(app, cookie, "/onboarding/discovery/family?q=project%20manager")).json();
    expect(hit.family).toBe("IT Project Manager");
    expect(hit.suggestions).toEqual(["project manager", "delivery manager"]);
    // #255: with two active families the QUERY decides — the positive direction of the
    // multi-family fix, not just the it-project-delivery regression above.
    const ba = (await get(app, cookie, "/onboarding/discovery/family?q=business%20analyst")).json();
    expect(ba.family).toBe("Business Analyst");
    expect(ba.suggestions).toContain("business analyst");
    // #255 gate defect 1: a query matching NEITHER family is a silent no-match (suggestions: []),
    // never a fallback family's words — the web renders suggestions as one-tap role submissions
    // under "same kind of job", so a fallback here was one tap from a wrong placement. #258 moved
    // this assertion off "scrum master", now an alias of IT project delivery, onto a phrase outside
    // every published family: the RULE is unchanged, only the phrase that proves it.
    const nomatch = (await get(app, cookie, "/onboarding/discovery/family?q=marine%20engineer")).json();
    expect(nomatch.suggestions).toEqual([]);
    // #258: a title the family's SCOPE names as inside it is findable by typing, even though it is
    // not a market search word. What comes back is the family's MARKET titles, never the alias.
    // "delivery lead" is the AC's own case for no advert-count gate: #242 measured it at 0 adverts
    // in Hong Kong, so it can never be a search word — and it is still findable by typing.
    for (const alias of ["scrum master", "agile coach", "delivery lead", "release manager"]) {
      const hint = (await get(
        app,
        cookie,
        `/onboarding/discovery/family?q=${encodeURIComponent(alias)}`,
      )).json();
      expect({ alias, ...hint }).toEqual({
        alias,
        family: "IT Project Manager",
        suggestions: ["project manager", "delivery manager"],
      });
    }
    const ra = (await get(app, cookie, "/onboarding/discovery/family?q=requirements%20analyst")).json();
    expect(ra.family).toBe("Business Analyst");
    expect(ra.suggestions).toContain("business analyst");
    expect(ra.suggestions).not.toContain("requirements analyst");
    const empty = (await get(app, cookie, "/onboarding/discovery/family?q=")).json();
    expect(empty.suggestions).toEqual([]);
  });

  // #184: city now comes from the confirmed search area, not role text (ROLE names Paris, which
  // isn't even covered) — the intent route is set first, a covered market, to seed it.
  it("start seeds family/city/promise + the production essential floor + the role line", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const s: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    // #214 owner decision (post-GO follow-up): with up to 3 selected places, the promise sentence
    // no longer names one of them — the display city is always null now.
    expect(s).toMatchObject({ role: ROLE, family: "IT Project Manager", city: null });
    // #246: question 1 pays for a real search and waits for it, so the number on the very first
    // screen is the pool HER search returned — 16 of the harness's 17 adverts, the 17th being one
    // she cannot read. It is deliberately NOT 10, the count of adverts stamped into the family she
    // is interviewed on: that was the number the deck could not keep. The promise names nothing at
    // all now — no family, no place — so a count is the whole of it.
    expect(s.promise).toEqual({ count: 16 });
    expect(s.essentialRemaining).toBe(4); // 4 essential items in the production floor
    expect(s.questions.map((q) => q.itemId)).toEqual([
      END_TO_END,
      STAKEHOLDERS,
      RISKS,
      COMMUNICATION,
      "eligibility-work-rights-hong-kong",
      "eligibility-languages",
    ]);
    // #106 code-review must-fix 2: the eligibility questions are visible from Q1 too, appended
    // after the 4 production floor questions (never withheld until the essential band is covered). #162 removed
    // the years-experience one — worked out, never asked.
    expect(s.questions).toHaveLength(6); // 4 essential + 2 eligibility
    expect(s.cvLines[0]).toMatchObject({ itemId: "role", text: "IT project manager in Paris" });
  });

  // #246 AC4 — the defect itself, stated as a number. Her search returns TWO adverts; ten adverts
  // in the pool are stamped into the family her interview asks about. Before this ticket the promise
  // said 10 and her deck could serve at most 2. The promise now counts the same search the deck is
  // built from, so the two can no longer disagree — and the assertion is only meaningful because
  // #63 made the deck count genuinely retrieved postings rather than the same fixture file.
  it("#246: the promise counts HER search, not the family her interview asks about", async () => {
    const two = loadPostings().slice(0, 2);
    const { app } = buildServer({ retrievePostings: fixtureRetriever(two) });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const s: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(s.promise).toEqual({ count: 2 });
  });

  // #246 AC1 — a search that returned nothing to count leaves NO promise, so the screen prints no
  // sentence at all (design §4c) instead of a number it cannot stand behind. The old code could not
  // reach this state: it counted a file that is always there.
  it("#246: no promise at all when the search found nothing", async () => {
    const { app } = buildServer({ retrievePostings: fixtureRetriever([]) });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const s: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(s.promise).toBeNull();
  });

  // #246 — a search that FAILS costs her the number and nothing else: no promise, and the interview
  // still opens normally. (The other way to reach this — the provider taking longer than
  // PROMISE_SEARCH_TIMEOUT_MS — lands on the same null through the same branch; the race itself is
  // withReadTimeout's, directly tested in cards.test.ts, and re-proving it here would buy a 4s wait
  // on every CI run for a second look at one `catch`.)
  it("#246: a failed search costs the promise, never the screen", async () => {
    const { app } = buildServer({
      retrievePostings: async () => {
        throw new Error("provider down");
      },
    });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const s: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(s.promise).toBeNull();
    // The interview itself is untouched — she is asked her four essential questions as always.
    expect(s.essentialRemaining).toBe(4);
    expect(s.cvLines[0]).toMatchObject({ itemId: "role" });
  });

  // #246 — question 1 pays for ONE search, and the rest of the interview reads what it left behind.
  // The number has to survive her answers (each one moves the retrieval fingerprint, so a promise
  // keyed to a reusable snapshot would blink out on the first tap), and it must not re-spend to do
  // it — a provider call per answered question is a bill nobody agreed to.
  it("#246: one paid search at question 1; the number then survives answers and a reload for free", async () => {
    let searches = 0;
    const retriever = fixtureRetriever();
    const { app } = buildServer({
      retrievePostings: async (input) => {
        searches += 1;
        return retriever(input as never);
      },
    });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.promise).toEqual({ count: 16 });
    expect(searches).toBe(1);

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" })
    ).json();
    expect(answered.promise).toEqual({ count: 16 });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.promise).toEqual({ count: 16 });
    expect(searches).toBe(1);
  });

  // #246 QA finding 2 — the quota guard, and the reason it exists. `/onboarding/discovery/start` is
  // anonymous and needs nothing earned, and EVERY distinct role string is a distinct provider query,
  // so before this guard one visitor retyping her job title was an open tap into the month's call
  // budget (techmap: 1000/month). One search per session, whatever she retypes.
  it("#246: retyping question 1 never buys a second search, and never keeps the old job's number", async () => {
    let searches = 0;
    const retriever = fixtureRetriever();
    const { app } = buildServer({
      retrievePostings: async (input) => {
        searches += 1;
        return retriever(input as never);
      },
    });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    expect(
      ((await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json() as DiscoveryState).promise,
    ).toEqual({ count: 16 });

    for (const role of ["welder", "baker in Hong Kong", "florist", "airline pilot"]) {
      const retyped: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role })).json();
      // Silence, not the previous job's number: 16 counted a search for the job she just stopped
      // asking for, and showing it against these words is this ticket's own defect, re-dressed.
      expect(retyped.promise).toBeNull();
    }
    expect(searches).toBe(1);
  });

  it("a positive answer adds a CV line, advances its section bar + the countdown", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: END_TO_END,
        answer: "Yes",
      })
    ).json();
    expect(s.cvLines.some((l) => l.itemId === END_TO_END && /Owned delivery/.test(l.text))).toBe(true);
    expect(s.essentialRemaining).toBe(3); // one essential closed
    expect(s.railFill.experience).toBeGreaterThan(0);
    expect(s.questions.map((q) => q.itemId)).not.toContain(END_TO_END); // never re-offered
    expect(s.factCount).toBe(1); // #17/#23: one recorded answer so far
  });

  it("a 'no' answer closes the item (advances the countdown) but adds no CV line — persisted as a negative", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: RISKS,
        answer: "No",
      })
    ).json();
    expect(s.essentialRemaining).toBe(3); // the "no" still closed it
    expect(s.cvLines.some((l) => l.itemId === RISKS)).toBe(false); // no line for a "no"
    expect(s.questions.map((q) => q.itemId)).not.toContain(RISKS);
    // persisted as a negative (the #13 write path), not a confirmed positive:
    const session = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = session.json().id as string;
    expect((await claims.negatives(sid)).map((c) => c.id)).toContain(discoveryClaimId(RISKS));
    expect((await claims.confirmed(sid)).map((c) => c.id)).not.toContain(discoveryClaimId(RISKS));
  });

  it("a hedged 'No, but …' answer is conserved as a CV line — never dropped as a negative (conservation)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const s: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: COMMUNICATION,
        answer: "No, but a related certification",
      })
    ).json();
    // the qualification is a real fact → a positive CV line in its section, NOT a negative claim.
    expect(s.cvLines.some((l) => l.itemId === COMMUNICATION)).toBe(true);
    const session = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = session.json().id as string;
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain(discoveryClaimId(COMMUNICATION));
    expect((await claims.negatives(sid)).map((c) => c.id)).not.toContain(discoveryClaimId(COMMUNICATION));
  });

  it("answers persist server-side — a reload (fresh GET) resumes with the lines, not re-derived from the client", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.role).toBe(ROLE);
    expect(resumed.cvLines.map((l) => l.itemId)).toEqual(["role", END_TO_END, STAKEHOLDERS]);
    expect(resumed.essentialRemaining).toBe(2);
  });

  it("an unknown itemId is a 404; re-answering an already-answered item is idempotent, not a 409 (#18 AC4)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    expect((await post(app, cookie, "/onboarding/discovery/answer", { itemId: "nope", answer: "x" })).statusCode).toBe(404);
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    const corrected: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes, under $1M" })
    ).json();
    expect(corrected.essentialRemaining).toBe(3); // still closed once — not double-counted
    expect(corrected.cvLines.find((l) => l.itemId === END_TO_END)?.text).toMatch(/under \$1M/);
  });

  it("answering before Q1 (no role) is a 409, not a write", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    expect(res.statusCode).toBe(409);
  });

  it("rejects malformed answer payloads before family placement", async () => {
    let placements = 0;
    const { app } = buildServer({
      placeFamily: async () => {
        placements += 1;
        return IT_PROJECT_DELIVERY_PLACEMENT;
      },
    });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    placements = 0;

    const res = await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: END_TO_END,
      answer: "Yes",
      answers: ["Yes"],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "invalid_answer" } });
    expect(placements).toBe(0);
  });

  // #18 AC1 — the gate: the last essential item answered flips stage to "deck", and it's PERSISTED
  // (a fresh GET, and the session's own stage, both read "deck" — not just the one response).
  // #106: the essential band alone no longer flips it — three eligibility questions are also due; see
  // the "#106 eligibility questions in discovery" describe block below for that gate on its own.
  it("answering the last essential item flips stage to deck only once eligibility is also closed; a fresh GET and the session both persist it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    const mid: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: RISKS,
        answer: "Yes",
      })
    ).json();
    expect(mid.stage).toBe("discovery"); // one essential item still open

    // The last essential item — closed by a bare "no" ("not necessarily satisfied", AC1's own wording).
    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: COMMUNICATION, answer: "No" })
    ).json();
    expect(last.essentialRemaining).toBe(0);
    expect(last.stage).toBe("discovery"); // #106: the eligibility questions are now pending
    const eligibilityIds = last.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligibilityIds).toHaveLength(2);

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
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "No" });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.questions.map((q) => q.itemId)).not.toContain(RISKS);
    expect(resumed.cvLines.some((l) => l.itemId === RISKS)).toBe(false);
  });

  // #18 AC4 — correction, both directions: an accidental "no" fixed to a real "yes,…" gains a CV
  // line; a real "yes" corrected to a bare "no" loses it. Same idempotent route both ways.
  it("correcting an answer flips it: no→yes gains a CV line, yes→no drops it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: COMMUNICATION, answer: "No" });
    const fixed: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: COMMUNICATION,
        answer: "Reported weekly steering updates",
      })
    ).json();
    expect(fixed.cvLines.find((l) => l.itemId === COMMUNICATION)?.text).toMatch(/weekly steering updates/);

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "Yes" });
    const reverted: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "No" })
    ).json();
    expect(reverted.cvLines.some((l) => l.itemId === RISKS)).toBe(false);
  });

  it("the route uses the production floor only — no old triggered stub item is surfaced", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");
    expect((await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-employer-dates", answer: "x" })).statusCode).toBe(
      404,
    );
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
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "No" });
    const before: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: COMMUNICATION, answer: "No" })
    ).json();
    expect(before.essentialRemaining).toBe(0); // essential band fully asked
    // #106: stage no longer flips to deck on the essential band alone — eligibility is now pending.
    expect(before.stage).toBe("discovery");
    const railBefore = before.railFill.experience;

    // The reject route is post-wall (requireUser) — sign in, like #33's own route test does.
    await signIn(app, cookie, "reject-reopens@example.com");
    const rejectRes = await app.inject({
      method: "POST",
      url: `/onboarding/claims/${discoveryClaimId(END_TO_END)}/reject`,
      headers: { cookie },
    });
    expect(rejectRes.statusCode).toBe(200);

    const after: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    // AC1: the question does not come back.
    expect(after.questions.map((q) => q.itemId)).not.toContain(END_TO_END);
    // AC2: railFill for that section never decreases. Pinned to the literal as well as the AC's own
    // >= shape: a bare >= also passes when the value RISES because the denominator shrank (askable
    // losing an item), which is the failure mode the sibling trigger test below exists to catch.
    expect(railBefore).toBe(1);
    expect(after.railFill.experience).toBe(1);
    expect(after.railFill.experience).toBeGreaterThanOrEqual(railBefore);
    // AC3: essentialRemaining never increases.
    expect(after.essentialRemaining).toBeLessThanOrEqual(before.essentialRemaining);
  });

  it("rejecting a claim does not evict the answered production item from railFill (#35)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    const before: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: STAKEHOLDERS,
        answer: "Business, engineering, and vendors",
      })
    ).json();
    expect(before.railFill.experience).toBe(2 / 3); // 2 of 3 production experience items answered

    await signIn(app, cookie, "reject-trigger@example.com");
    const rejectRes = await app.inject({
      method: "POST",
      url: `/onboarding/claims/${discoveryClaimId(END_TO_END)}/reject`,
      headers: { cookie },
    });
    expect(rejectRes.statusCode).toBe(200);

    const after: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(after.questions.map((q) => q.itemId)).not.toContain(END_TO_END); // still not re-asked
    expect(after.railFill.experience).toBe(2 / 3); // unchanged, not just non-decreasing
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
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights")).toBeNull();
    expect(await eligibility.get(sid, "language")).toBeNull();
  });

  it("appears in questions from Q1, after the production essential band (must-fix 2, corrected in round 3)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.essentialRemaining).toBe(4); // essential band completely untouched
    expect(start.questions).toHaveLength(6); // 4 production essentials + 2 eligibility

    const eligDimensions = start.questions.map((q) => q.eligibility?.dimension ?? null);
    expect(eligDimensions.slice(0, 4)).toEqual([null, null, null, null]); // the 4 essential items
    expect(eligDimensions.slice(4)).toEqual(["work-rights", "language"]);
  });

  // Code-review round 3, the regression QA flagged directly: pins the funnel length so this can't
  // silently regress again. Before #106, a visitor cleared the essential band alone (~3 answers) and
  // reached the deck; the standard band was always optional/loopback-reachable, never required.
  it("reaches the deck after the essential band + eligibility questions, WITHOUT ever being asked the standard band (funnel regression)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const eligIds = start.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligIds).toHaveLength(2);

    let state = start;
    for (const itemId of eligIds) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })).json();
    }
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: END_TO_END,
      answer: "Yes",
    });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "No" });
    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: COMMUNICATION, answer: "No" })
    ).json();

    expect(last.stage).toBe("deck"); // reached with only production essentials (4) + eligibility (2) = 6 answers
    expect(last.questions.map((q) => q.itemId)).not.toContain("budget-employer-dates");
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
    // exactly: eligibility questions sitting in `questions` moved nothing.
    const floorOnly = discoveryState(ROLE, confirmed, negatives, [], null, PRODUCTION_DISCOVERY_FAMILY);
    expect(start.railFill).toEqual(floorOnly.railFill);
    expect(start.essentialRemaining).toBe(floorOnly.essentialRemaining);
  });

  it("stage flips to deck only once BOTH bands are closed, regardless of which finishes first (must-fix 2)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const eligIds = start.questions.filter((q) => q.eligibility).map((q) => q.itemId);
    expect(eligIds).toHaveLength(2);

    // Close every eligibility question FIRST, well before the essential band — legitimate under the
    // fix (they're always visible), and exactly the ordering the old withholding gate would have
    // broken the countdown on.
    let state = start;
    for (const itemId of eligIds) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION })).json();
      expect(state.stage).toBe("discovery"); // essential band still fully open
    }

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: STAKEHOLDERS,
      answer: "Business, engineering, and vendors",
    });
    const mid: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: RISKS,
        answer: "Yes",
      })
    ).json();
    expect(mid.stage).toBe("discovery"); // one essential item still open

    const last: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: COMMUNICATION, answer: "No" })
    ).json();
    expect(last.stage).toBe("deck"); // both bands closed now, whichever order they closed in
  });

  it("a real value answer produces no CV line, closes the question, and lands in the eligibility store", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: workRights.itemId,
        answer: "Yes — no sponsorship needed",
      })
    ).json();
    expect(answered.cvLines.some((l) => l.itemId === workRights.itemId)).toBe(false); // #106 AC7
    expect(answered.questions.map((q) => q.itemId)).not.toContain(workRights.itemId); // closed, never re-offered

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const fact = await eligibility.get(sid, "work-rights", workRights.eligibility!.familyId);
    expect(fact).toMatchObject({ value: "eligible" });
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

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Yes — no sponsorship needed",
    });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const [confirmed, negatives] = await Promise.all([claims.confirmed(sid), claims.negatives(sid)]);
    const allIds = [...confirmed, ...negatives].map((c) => c.id);
    expect(allIds).not.toContain(discoveryClaimId(workRights.itemId));
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
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Not yet — I'd need sponsorship",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // #182/#184: stored at the SLUG of the RESOLVED search area (not the old global scope, never the
    // raw display string — QA round 3 must-fix: kebab slug, not "Hong Kong").
    expect(await eligibility.get(sid, "work-rights", "hong-kong")).toMatchObject({ value: "needs-sponsorship" });
  });

  // Code-review must-fix 5: correcting TO a decline must retract a prior real answer's stored value —
  // eligibility.remove() exists and was unused. Without this, slice 6 (#107) would withdraw jobs on
  // an answer the visitor explicitly retracted, while the screen tells them nobody knows.
  it("correcting a real answer TO a decline retracts the stored fact (must-fix 5)", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Not yet — I'd need sponsorship",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // #182/#184: stored at the SLUG of the resolved search area.
    expect(await eligibility.get(sid, "work-rights", "hong-kong")).toMatchObject({ value: "needs-sponsorship" }); // stored

    const corrected: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION })
    ).json();
    expect(corrected.questions.map((q) => q.itemId)).not.toContain(workRights.itemId); // still closed
    expect(await eligibility.get(sid, "work-rights", "hong-kong")).toBeNull(); // retracted, not stale
  });

  it("re-answering an eligibility question corrects it, exactly like the existing idempotent upsert", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    const answer = (a: string) =>
      post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: a });

    await answer("Not yet — I'd need sponsorship");
    await answer("Yes — no sponsorship needed");

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights", workRights.eligibility!.familyId)).toMatchObject({
      value: "eligible",
    });
  });

  // #162 / ADR-0008 clause 2's falsifiable check, at the live route: the total is worked out from
  // the dated job records, so asking for it would collect an answer the next recompute deletes.
  it("no question ever asks for a years-of-experience total (ADR-0008 clause 2)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.some((q) => q.eligibility?.dimension === "years-experience")).toBe(false);
    expect(start.questions.some((q) => /how many years/i.test(q.question))).toBe(false);
  });

  // Code-review must-fix 8: the decline's recorded text rebuilds the question, so it must reflect the
  // CITY THE VISITOR WAS ACTUALLY ASKED ABOUT, not a generic placeholder. #184: that city is the
  // CONFIRMED SEARCH AREA now, not a guess off the role text (ROLE names Paris, which #184 doesn't
  // even cover — the search area is the one and only location signal from here on).
  it("a work-rights decline records the real city the visitor was asked about, not a placeholder (must-fix 8)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    expect(workRights.question).toBe("Can you already work in Hong Kong without visa sponsorship?");

    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const negatives = await claims.negatives(sid);
    const declineClaim = negatives.find((c) => c.id === discoveryClaimId(workRights.itemId))!;
    expect(declineClaim.text).toContain("Hong Kong");
    expect(declineClaim.text).not.toContain("where you're job-hunting"); // the generic fallback text
  });

  // #182 QA round 3, MUST-FIX (still true under #184's resolved-market key): a multi-word city used to
  // reach the decline's claim id raw ("discovery-eligibility-work-rights-Hong Kong") — a space and a
  // capital, both illegal in ClaimGraph's kebab-slug id contract — so /onboarding/build looped back.
  // The key is slug(market) ("hong-kong"), never the raw display string.
  it("#182/#184: a decline in a MULTI-WORD resolved market produces a valid kebab-slug claim id and /onboarding/build reaches ready", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "qa182-multiword@example.com");
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const start: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager" })
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

  // #184: case and whitespace variants of ONE search area must land on the SAME work-rights market
  // key — proven here at the intent route (resolveSearchArea's own robustness), which is now the
  // ONLY place a market key is ever produced from (the old role-text regex path is subordinated —
  // #182 QA round 3's original version of this test, over role-text variants, no longer applies:
  // production stops reading role text for a city at all).
  it("#184: case and whitespace variants of one search area resolve to the SAME work-rights market key", async () => {
    const { app } = buildServer();
    const itemIdFor = async (searchArea: string) => {
      const cookie = await anonSession(app);
      await put(app, cookie, "/sessions/me/intent", { searchArea });
      const start: DiscoveryState = (
        await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager" })
      ).json();
      return start.questions.find((q) => q.eligibility?.dimension === "work-rights")!.itemId;
    };
    const ids = await Promise.all(
      ["Hong Kong", "hong kong", "HONG KONG", "Hong  Kong", "Hong kong,"].map(itemIdFor),
    );
    expect(new Set(ids).size).toBe(1); // every variant is the SAME market key
    expect(ids[0]).not.toBe("eligibility-work-rights-*"); // the lowercase variant found a real market, not ANY_FAMILY
  });

  // #184 AC: the work-rights question's city and the confirmed search area can no longer disagree —
  // ONE location signal, proven by reading both off the SAME response.
  it("#184 AC: the work-rights question's city never disagrees with the confirmed search area", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const intent = await put(app, cookie, "/sessions/me/intent", { searchArea: "Sydney, Australia" });
    // #214: the intent response carries the resolved chip list now, not a single resolution.
    expect(intent.json().intent.searchAreas).toMatchObject([
      { text: "Sydney, Australia", market: "Australia", marketKey: "australia", label: "Sydney" },
    ]);
    const start: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager in Hong Kong" }) // role deliberately names a DIFFERENT city
    ).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    // The question follows the CONFIRMED search area's market (Australia), never the role text
    // (Hong Kong). #214 owner decision: the promise sentence names no place at all — with several
    // selected places, naming one was a half-truth.
    expect(workRights.question).toBe("Can you already work in Australia without visa sponsorship?");
    // #246: the promise carries a number and NOTHING else — no place, and no job family either.
    expect(Object.keys(start.promise!)).toEqual(["count"]);
  });

  // #184 compat story: a #182-era answer keyed by parseCity(role) survives ONLY when the two slugs
  // happen to coincide (role naming the country outright, e.g. "…in Hong Kong" — slug("Hong Kong")
  // is "hong-kong" either way). A CITY-specific old answer (e.g. "…in Sydney", parseCity-slugged to
  // "sydney") does NOT coincide with #184's country-level "australia" key — an accepted pre-launch
  // consequence (a re-ask, never a crash or a silently wrong answer): gating itself stays correct
  // regardless, because withdrawal.ts matches by REGION, not exact key identity (a "sydney"-keyed
  // fact still correctly gates an Australian posting — see cards.test.ts's #182 AC3 pair).
  it("#184 compat: the resolved marketKey coincides with #182's old parseCity-slug ONLY when the city IS the country name", async () => {
    const { app } = buildServer();
    const coincides = async (searchArea: string) => {
      const cookie = await anonSession(app);
      await put(app, cookie, "/sessions/me/intent", { searchArea });
      const start: DiscoveryState = (
        await post(app, cookie, "/onboarding/discovery/start", { role: `IT project manager in ${searchArea}` })
      ).json();
      const itemId = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!.itemId;
      return { marketKey: itemId, oldParseCitySlug: `eligibility-work-rights-${slug(searchArea)}` };
    };
    // "Hong Kong" the search area IS "Hong Kong" the country/territory name — the two slugs coincide.
    const hk = await coincides("Hong Kong");
    expect(hk.marketKey).toBe(hk.oldParseCitySlug);
    // "Sydney" resolves (AC2) but confirms back as "Australia" (country-level) — the two DIVERGE.
    const sydney = await coincides("Sydney");
    expect(sydney.marketKey).not.toBe(sydney.oldParseCitySlug);
    expect(sydney.marketKey).toBe("eligibility-work-rights-australia");
  });

  // #214: work-rights is asked once per selected MARKET — two markets, two questions, each
  // independently answerable at its own market's scope; two chips in the SAME country stay one.
  it("#214: N selected markets produce N work-rights questions; same-country chips produce one", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchAreas: ["Hong Kong", "Sydney"] });
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.filter((q) => q.eligibility?.dimension === "work-rights");
    expect(workRights.map((q) => q.eligibility!.familyId)).toEqual(["hong-kong", "australia"]);
    expect(workRights.map((q) => q.question)).toEqual([
      "Can you already work in Hong Kong without visa sponsorship?",
      "Can you already work in Australia without visa sponsorship?",
    ]);

    // Each is answerable at its own scope, independently.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights[0].itemId,
      answer: "Yes — no sponsorship needed",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights", "hong-kong")).toMatchObject({ value: "eligible" });
    expect(await eligibility.get(sid, "work-rights", "australia")).toBeNull(); // the other market stays unknown

    // Two chips in the SAME country: still one work-rights question.
    const cookie2 = await anonSession(app);
    await put(app, cookie2, "/sessions/me/intent", { searchAreas: ["Sydney", "Melbourne"] });
    const start2: DiscoveryState = (await post(app, cookie2, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights2 = start2.questions.filter((q) => q.eligibility?.dimension === "work-rights");
    expect(workRights2.map((q) => q.eligibility!.familyId)).toEqual(["australia"]);
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
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    const res = await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Maybe, one day",
    });
    expect(res.statusCode).toBe(400);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    // Nothing was written — a rejected answer never half-lands.
    expect(await eligibility.get(sid, "work-rights", workRights.eligibility!.familyId)).toBeNull();
  });

  it("resumes identically on a fresh GET — the whole screen stays a pure function of persisted state", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: workRights.itemId,
        answer: "Yes — no sponsorship needed",
      })
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
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: "Yes — no sponsorship needed",
    });
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights", workRights.eligibility!.familyId)).toMatchObject({
      value: "eligible",
    });
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

  it("#165 AC1: is a type-ahead whose options are COMPLETIONS, with the new copy and the same itemId", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const language = languageQuestion(start);

    expect(language.itemId).toBe("eligibility-languages");
    expect(language.multiSelect).toBe(true);
    expect(language.typeAhead).toBe(true);
    expect(language.question).toBe("Which languages do you speak? Start typing — I'll suggest as you go.");
    // #165: the consequence no longer threatens a removal, because listing languages no longer causes
    // one — the only thing that withdraws is a deliberate "I don't speak this one" on the ladder.
    expect(language.consequence).toBe(
      "Nothing you leave out counts against you: a job wanting a language you didn't list still stays in your deck." +
        " When one of them matters for a real job, I'll ask how well you speak it, and say why.",
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

  // 🚨 #165 AC2, through the real route: what a person leaves out is written NOWHERE. The old shape
  // recorded "none" for every unticked language and withdrew postings on it.
  it("#165 AC2: an answer stores only the languages named — the rest stay unknown, never 'none'", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Cantonese"] });

    expect(await eligibility.get(sid, "language", "English")).toMatchObject({ value: "declared" });
    expect(await eligibility.get(sid, "language", "Cantonese")).toMatchObject({ value: "declared" });
    expect(await eligibility.get(sid, "language", "Mandarin")).toBeNull();
    expect(await eligibility.get(sid, "language", "Vietnamese")).toBeNull();
  });

  // #165 AC1 / #125: a language off the market list is kept as the person's own fact, in their own
  // spelling. It matches no advert until the list learns it — but it is never refused or dropped.
  it("#165 AC1: a language outside the known list is kept, in the words the person used", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["French"] });
    expect(res.statusCode).toBe(200);
    expect(await eligibility.get(sid, "language", "French")).toMatchObject({ value: "declared" });
  });

  // #165: answers: [] stays legal and now records nothing at all. The question stays OPEN, because
  // "answered" is read from a stored fact and there is none — which is the honest state: the person
  // named no language, so nothing is known about any of them. Nothing is withdrawn either way.
  it("answers: [] is still a legal answer, and now stores nothing at all", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: [] });
    expect(res.statusCode).toBe(200);
    expect(await eligibility.get(sid, "language", "English")).toBeNull();
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

  it("#165: correcting the list adds what was added and RETRACTS what was dropped — never to a 'no'", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toBeNull();

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Mandarin"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "declared" });

    // Dropping English returns it to UNKNOWN (#125's own AC), which never withdraws anything.
    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["Mandarin"] });
    expect(await eligibility.get(sid, "language", "English")).toBeNull();
  });

  it("declining retracts every previously-stored language fact (must-fix 5, applied to the whole list)", async () => {
    const { app, eligibility, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "Mandarin"] });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "declared" });

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

  // 🚨 #165 QA gate, DEFECT-1 — the regression that blocked the gate, driven the way the gate drove
  // it. A level placed on the ladder is an answer to a DIFFERENT question (#125: once per language
  // ever; ADR-0011 clause 4: answering closes it permanently), so declining "which languages do you
  // speak" must not touch it. The web client sends exactly this decline when a person confirms the
  // languages question with nothing listed, so before the fix an ordinary edit to a language list
  // silently destroyed every rung they had placed — including the deliberate "I don't speak this
  // one", which is never shown in that list and so could never be re-stated through it.
  it("declining does NOT retract a placed level — only the bare declarations go (QA DEFECT-1)", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "French"] });
    // #308: the ladder's HTTP door is deleted — a rung is placed through the ladder's own write
    // function, the same call the tailor queue's profile-answer route makes.
    await answerLanguageLevel(eligibility, sid, "Cantonese", "meetings");
    await answerLanguageLevel(eligibility, sid, "Mandarin", "not-at-all");

    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: DECLINE_OPTION });

    // The placed rungs survive, both of them — including the one that withdraws jobs.
    expect(await eligibility.get(sid, "language", "Cantonese")).toMatchObject({ value: "meetings" });
    expect(await eligibility.get(sid, "language", "Mandarin")).toMatchObject({ value: "not-at-all" });
    // The bare declarations are retracted, which is what a decline on THIS question means.
    expect(await eligibility.get(sid, "language", "English")).toBeNull();
    expect(await eligibility.get(sid, "language", "French")).toBeNull();
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

  // #165: the list is open, so an unrecognised WORD is no longer an error (see the French case
  // above). What is still refused is input that isn't a word at all — the trust boundary, not the
  // vocabulary.
  it("an answers array carrying something that isn't a word is a 400 invalid_answer, never stored", async () => {
    const { app, eligibility } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const itemId = languageQuestion(start).itemId;
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answers: ["English", "   "] });
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
