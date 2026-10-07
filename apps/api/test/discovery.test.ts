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
  composeRoleLine,
  type DiscoveryFamily,
  discoveryClaimId,
  discoveryState,
  factCount,
  isNoAnswer,
  isNonAnswer,
  NON_ANSWER,
  parseCity,
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

  it("#324: isNonAnswer catches a typed 'I don't know' — never a real answer, never a bare 'no'", () => {
    for (const a of ["I don't know", "I don’t know.", "dont know", "idk", "Not sure", "I'm not sure!", "n/a", "N/A", "N.A.",
      "no idea", "?", "Skip", "not sure yet", "I don't remember", "don't recall", "none", "Nothing."])
      expect(isNonAnswer(a), a).toBe(true);
    for (const a of ["No", "Business, engineering, and vendors", "Not sure yet which, but the CFO and IT", "I know SAP",
      "None of the vendors, only internal teams"])
      expect(isNonAnswer(a), a).toBe(false);
    // #339: the web client's hand-kept mirror of NON_ANSWER went with the free-text floor questions it
    // served; the server's pattern stays (recordDiscoveryAnswer, the fixture seam), so it is pinned here.
    expect(NON_ANSWER.test("idk")).toBe(true);
  });

  it("discoveryState before Q1 (no role) is the empty skeleton", () => {
    const s = discoveryState(null, [], []);
    expect(s).toMatchObject({ stage: "discovery", role: null, promise: null, questions: [], cvLines: [] });
    expect(s.factCount).toBe(0);
    // #339: the rail and the countdown are gone from the wire, not just zeroed.
    expect(s).not.toHaveProperty("railFill");
    expect(s).not.toHaveProperty("essentialRemaining");
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

  // #339 — discoveryState asks no floor question any more: once a role exists it returns no questions
  // and stage "deck" (eligibilityDiscovery.ts's applyEligibilityQuestions is what holds the visitor
  // in discovery). A floor answer a session gave before #339 is still her own words, so it keeps its
  // CV line; a "no" or a deck-rejected claim (never passed in any more) adds none.
  it("discoveryState asks nothing itself — stage 'deck' once a role exists; an earlier floor answer keeps its CV line", () => {
    const role = "IT project manager in Paris";
    const s = discoveryState(
      role,
      [discoveryClaim("budget-accountability")],
      [discoveryClaim("stakeholder-reporting")],
      PURE_DISCOVERY_FAMILY,
    );
    expect(s).toMatchObject({ stage: "deck", role, family: "IT project delivery", questions: [] });
    expect(s.cvLines.map((l) => l.itemId)).toEqual(["role", "budget-accountability"]);
    expect(s.factCount).toBe(2);
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

// #182's /onboarding/build case needs a signed-in session — build is post-wall (requireUser). Prior
// art: tailor.test.ts's own signIn helper.
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

const ROLE = "IT project manager in Paris, mostly ERP";
const END_TO_END = "end-to-end-delivery"; // a production floor item — #339: no longer asked
const HK_WORK_RIGHTS = "eligibility-work-rights-hong-kong";

// #339: a decline closes nothing, so reaching the deck takes a REAL answer to every eligibility
// question. Shaped from the question itself: the languages question is multi-select (`answers`),
// work-rights takes its first (affirmative) option.
const realAnswer = (q: DiscoveryState["questions"][number]) =>
  q.multiSelect ? { itemId: q.itemId, answers: ["English"] } : { itemId: q.itemId, answer: q.options[0]! };

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
  it("start seeds family/city/promise + only the eligibility questions + the role line", async () => {
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
    // #339: the family floor is no longer asked — the eligibility questions are the whole list, and
    // while they are open she stays in discovery. #162 removed the years-experience one.
    expect(s.questions.map((q) => q.itemId)).toEqual([HK_WORK_RIGHTS, "eligibility-languages"]);
    expect(s.stage).toBe("discovery");
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
    // The interview itself is untouched — she is asked her eligibility questions as always.
    expect(s.questions.map((q) => q.itemId)).toEqual([HK_WORK_RIGHTS, "eligibility-languages"]);
    expect(s.cvLines[0]).toMatchObject({ itemId: "role" });
  });

  // #246 — question 1 pays for ONE search, and the rest of the interview reads what it left behind.
  // The number has to survive her answers (an answer can move the retrieval fingerprint, so a promise
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
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: HK_WORK_RIGHTS, answer: "Yes — no sponsorship needed" })
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

  // #322 — the front door already took the job: discovery opens on the checklist, never re-asks it,
  // and the hand-off records the role exactly as question 1 would — one search, never two on reload.
  it("#322: a role given at the front door skips question 1 and is recorded once", async () => {
    let searches = 0;
    const retriever = fixtureRetriever();
    const { app } = buildServer({
      retrievePostings: async (input) => {
        searches += 1;
        return retriever(input as never);
      },
    });
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { targetRole: ROLE, searchArea: "Hong Kong" });
    const opened: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    const asked: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    // What question 1 would have produced, minus its own (now skipped) search.
    expect({ ...opened, promise: null }).toEqual({ ...asked, promise: null });
    expect(opened.questions[0]?.itemId).toBe(HK_WORK_RIGHTS);
    expect(opened.promise).toEqual({ count: 16 });

    const reloaded: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(reloaded.questions[0]?.itemId).toBe(HK_WORK_RIGHTS);
    expect(searches).toBe(1);
  });

  it("#322: with no role anywhere, discovery still opens on question 1", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await put(app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
    const opened: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(opened).toMatchObject({ role: null, questions: [] });
  });

  // #339 — a floor answer a session gave before the floor stopped being asked is still her own words,
  // so the screen keeps its line, read back from the store on every load (never from the client).
  it("a reload (fresh GET) resumes with the role line and an earlier floor answer's line, from the store", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const sid = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
    await claims.add(sid, {
      id: discoveryClaimId(END_TO_END),
      semantic_key: END_TO_END,
      field_key: null,
      field_value: null,
      field_label: null,
      role: "profile",
      text: "Owned delivery end to end.",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "Yes",
      needs_grill: false,
      grill_hint: null,
    });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.role).toBe(ROLE);
    expect(resumed.cvLines.map((l) => l.itemId)).toEqual(["role", END_TO_END]);
    expect(resumed.questions.map((q) => q.itemId)).not.toContain(END_TO_END); // and it is not asked
  });

  // #339: the answer route takes eligibility questions only — a floor item id is now as unknown as a
  // made-up one, and writes nothing. Re-answering a real question still corrects it (#18 AC4).
  it("an unknown itemId — a floor item included — is a 404 that writes nothing; re-answering is idempotent, not a 409 (#18 AC4)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    for (const itemId of ["nope", END_TO_END, "reader-role"]) {
      const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: "Yes" });
      expect(res.statusCode, itemId).toBe(404);
      expect(res.json(), itemId).toMatchObject({ error: { code: "unknown_item" } });
    }
    const sid = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
    expect(await claims.list(sid)).toEqual([]);

    const start: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    await post(app, cookie, "/onboarding/discovery/answer", realAnswer(workRights));
    const again = await post(app, cookie, "/onboarding/discovery/answer", realAnswer(workRights));
    expect(again.statusCode).toBe(200);
    expect((again.json() as DiscoveryState).questions.map((q) => q.itemId)).not.toContain(workRights.itemId);
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

  // #18 AC1 / #339 — the gate: the last eligibility question answered flips stage to "deck", and
  // it's PERSISTED (a fresh GET, and the session's own stage, both read "deck" — not just the one
  // response). The funnel is pinned too: with the floor gone, the eligibility questions are every
  // answer it takes to reach the deck.
  it("answering the last eligibility question flips stage to deck; a fresh GET and the session both persist it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.stage).toBe("discovery");
    expect(start.questions).toHaveLength(2); // work-rights + languages, nothing else

    const [first, last] = start.questions;
    const mid: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/answer", realAnswer(first!))).json();
    expect(mid.stage).toBe("discovery"); // one eligibility question still open
    const final: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/answer", realAnswer(last!))).json();
    expect(final).toMatchObject({ stage: "deck", questions: [] });

    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.stage).toBe("deck");
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("deck");
  });

  // #339: GET no longer reads ?job= — the reader-only question went with the floor (the CV is
  // reviewed instead, "Your CV, reviewed"). A job with mined roles, owned by this session, adds
  // nothing, and a stray ?job= never errors.
  it("a ?job= — even this session's job with mined roles — adds no reader-only question and never errors", async () => {
    const { app, store } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const sessionId = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
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
    for (const jobId of [job.id, "does-not-exist"]) {
      const res = await get(app, cookie, `/onboarding/discovery?job=${jobId}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as DiscoveryState).questions.map((q) => q.itemId);
      expect(ids).toEqual(start.questions.map((q) => q.itemId)); // the eligibility questions, nothing prepended
      expect(ids).not.toContain("reader-role");
    }
  });
});

// --- #106 eligibility questions in discovery ------------------------------------------------
// Storage is eligibility.ts's (#86 decisions 4+5, already merged and tested — eligibility.test.ts).
// This drives the SAME three live routes as "#16 discovery routes" above; the derivation (which
// three dimensions, and why) is docs/research/eligibility-dimensions-from-the-corpus.md.
//
// 2026-08-03 code review folded in here: must-fix 1 (an affirmative answer must never reach the
// claim graph as a confirmed-gap node), must-fix 2 (eligibility questions visible from Q1), must-fix 3
// (a decline must not inflate factCount), must-fix 5 (correcting to a decline must retract the
// stored fact). #339: a decline now stores nothing at all — no claim of any kind — so the question it
// declined stays open, is served again, and holds the stage at discovery.
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

  // #339: with the floor gone, the eligibility questions are the whole list from Q1.
  it("appears in questions from Q1, and is the whole question list (must-fix 2, #339)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.map((q) => q.eligibility?.dimension ?? null)).toEqual(["work-rights", "language"]);
  });

  // #339: "Ask me later" is not an answer — the deck opens on real answers only. Declining every
  // question leaves them all open and the stage at discovery; answering them for real opens it.
  it("a decline keeps the stage at discovery; only real answers to every question open the deck (#339)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions).toHaveLength(2);

    let state = start;
    for (const q of start.questions) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", { itemId: q.itemId, answer: DECLINE_OPTION })).json();
      expect(state.stage).toBe("discovery");
    }
    expect(state.questions.map((q) => q.itemId)).toEqual(start.questions.map((q) => q.itemId)); // all still open

    for (const q of start.questions) {
      state = (await post(app, cookie, "/onboarding/discovery/answer", realAnswer(q))).json();
    }
    expect(state.stage).toBe("deck");
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

  // #339: a decline stores nothing ANYWHERE — no eligibility fact and no claim of any kind (it used
  // to write a negative claim to close the question, which reached the graph as a confirmed gap). So
  // the question is not closed: the same response, and a fresh GET, serve it again.
  it("declining stores NO fact and NO claim — the dimension reads as unknown and the question is served again", async () => {
    const { app, eligibility, claims } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    const answered: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION })
    ).json();
    expect(answered.questions.map((q) => q.itemId)).toContain(workRights.itemId); // still open — asked again
    expect(answered.cvLines.some((l) => l.itemId === workRights.itemId)).toBe(false);
    const resumed: DiscoveryState = (await get(app, cookie, "/onboarding/discovery")).json();
    expect(resumed.questions.map((q) => q.itemId)).toContain(workRights.itemId);

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    expect(await eligibility.get(sid, "work-rights")).toBeNull(); // unknown, never "does not have it"
    expect(await claims.list(sid)).toEqual([]); // no negative, rejected or confirmed claim either
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
    expect(corrected.questions.map((q) => q.itemId)).toContain(workRights.itemId); // #339: open again
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

  // #182 QA round 3, MUST-FIX: a multi-word city used to reach the decline's claim id raw
  // ("discovery-eligibility-work-rights-Hong Kong") — a space and a capital, both illegal in
  // ClaimGraph's kebab-slug id contract — so /onboarding/build looped back. #339: a decline writes no
  // claim at all now, so nothing of it can reach the graph; build still reaches ready after one.
  it("#182/#184/#339: a decline in a MULTI-WORD resolved market writes no claim and /onboarding/build reaches ready", async () => {
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
    expect(await claims.list(sid)).toEqual([]);

    // Build needs at least one confirmed fact to leave `loopback` — seed one directly (this test's
    // subject is the DECLINE, not the mine pipeline).
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

  // #339: and writes no decline claim — the question is open again, asked on the next load.
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
    expect(declined.questions.some((q) => q.itemId === itemId)).toBe(true); // #339: open again
    for (const language of ["English", "Mandarin", "Cantonese", "Vietnamese"]) {
      expect(await eligibility.get(sid, "language", language)).toBeNull(); // retracted, not stale
    }
    expect((await claims.list(sid)).some((c) => c.id === discoveryClaimId(itemId))).toBe(false);
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

// --- #336 the CV's languages pre-tick the languages question ------------------------------------
describe("#336 languages pre-ticked from the CV's own level", () => {
  const langClaim = (id: string, text: string) => ({
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text,
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
    source_quote: text,
    needs_grill: false,
    grill_hint: null,
  });
  async function withCvLanguages() {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const sid = (await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
    await server.claims.seed(sid, [
      langClaim("lang-polish", "Polish (Native)"),
      langClaim("lang-english", "English (Fluent)"),
      langClaim("lang-german", "German (Professional working proficiency)"),
      langClaim("lang-french", "French (Conversational)"),
      langClaim("lang-italian", "Italian"),
    ]);
    const start: DiscoveryState = (await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const question = start.questions.find((q) => q.eligibility?.dimension === "language")!;
    return { ...server, cookie, sid, question };
  }

  it("carries every CV language with its level word; only Native, Fluent and Professional pre-tick", async () => {
    const { question } = await withCvLanguages();
    expect(question.cvLanguages).toEqual([
      { language: "Polish", level: "Native", preTicked: true },
      { language: "English", level: "Fluent", preTicked: true },
      { language: "German", level: "Professional working proficiency", preTicked: true },
      { language: "French", level: "Conversational", preTicked: false },
      { language: "Italian", level: null, preTicked: false },
    ]);
  });

  it("pre-ticking stores nothing: no language fact exists until the person submits", async () => {
    const { eligibility, sid } = await withCvLanguages();
    expect((await eligibility.list(sid)).filter((f) => f.dimension === "language")).toEqual([]);
  });

  it("what the person submits is what is stored — an untick and an added language included", async () => {
    const { app, cookie, eligibility, sid, question } = await withCvLanguages();
    // Unticks German, keeps Polish and English, adds Swedish the CV does not list.
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: question.itemId, answers: ["Polish", "English", "Swedish"] });
    const stored = (await eligibility.list(sid)).filter((f) => f.dimension === "language").map((f) => f.familyId);
    expect(stored.sort()).toEqual(["English", "Polish", "Swedish"]);
  });

  it(`"${DECLINE_OPTION}" stores no language at all`, async () => {
    const { app, cookie, eligibility, sid, question } = await withCvLanguages();
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: question.itemId, answer: DECLINE_OPTION });
    expect((await eligibility.list(sid)).filter((f) => f.dimension === "language")).toEqual([]);
  });

  it("a CV with no languages sends no cvLanguages field", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.find((q) => q.eligibility?.dimension === "language")).not.toHaveProperty("cvLanguages");
  });
});
