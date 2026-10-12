// #338 — "Your CV, reviewed": the CV as read, on paper, before any jobs (ADR-0016 clauses 2, 5, 6).
// Driven over HTTP (the spec's main seam) with a fake miner. What it proves:
//   - the paper: letterhead first, then each job with its lines as read, ticked, in CV order;
//   - untick → kept and re-tick → ticked, both read back from the server;
//   - a job with no end date asks on its own card; an answer corrects the record and moves the
//     years total; an unreadable one is refused and stores nothing;
//   - an import conflict shows on the paper and settles once;
//   - THE JOBS GATE: the deck, the want door and the tailor refuse a session that brought a CV until
//     the review is completed, and open after — while a session with no CV is never held. Remove
//     `reviewOpensJobs` from sessionDeckIsAuthorized / buildDeckResponse and the gate tests go red;
//   - completing confirms the lines as read (they print on the master CV; a kept one does not), and
//     the review stays open afterwards with its changes persisted.
import { describe, expect, it } from "vitest";
import type { CandidateClaim, MinedJobBlock } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { getCardsWhenRetrieved, liveIdFor } from "./fixtureDeck.js";
import { isTerminal } from "../src/jobs.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { refreshWorkedYears } from "../src/yearsWorked.js";
import type { ReviewState } from "../src/cvReview.js";
import { languagesUnion } from "../src/eligibilityDiscovery.js";
import { sessionPostings } from "../src/preview.js";
import type { BroughtJob } from "../src/broughtJobs.js";
import type { SessionRecord } from "../src/sessions.js";

type Server = ReturnType<typeof buildServer>;
type App = Server["app"];

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = liveIdFor("2026-07-05_endava-vietnam_senior-project-manager");

const CV_TEXT = [
  "Jane Doe",
  "+33 6 00 00 00 00 | jane.doe.338@example.com",
  "Paris, France",
  "",
  "EXPERIENCE",
  "IT Project Manager, Nordic Retail Group — Mar 2021 - Present",
  "- Led the checkout replatform.",
  "- Managed a budget of EUR 1.2M across 3 vendor teams.",
  "",
  "Project Coordinator, Baltic Software House — Jun 2017 - ",
  "- Coordinated releases for 4 agile squads.",
  "",
  "EDUCATION",
  "MSc Management Information Systems, University of Warsaw, 2017",
].join("\n");

const claim = (over: Partial<CandidateClaim> & Pick<CandidateClaim, "id" | "text">): CandidateClaim => ({
  semantic_key: over.id,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: over.text.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
  ...over,
});
const NRG = "IT Project Manager - Nordic Retail Group";
const BSH = "Project Coordinator - Baltic Software House";
const MINED: CandidateClaim[] = [
  claim({ id: "nrg-led-checkout", role: NRG, text: "Led the checkout replatform." }),
  claim({ id: "nrg-managed-budget", role: NRG, text: "Managed a budget of EUR 1.2M across 3 vendor teams." }),
  claim({ id: "bsh-coordinated-releases", role: BSH, text: "Coordinated releases for 4 agile squads." }),
  claim({ id: "edu-msc-mis-warsaw", role: "MSc Management Information Systems - University of Warsaw", text: "Holds an MSc in MIS." }),
  claim({ id: "skill-tools", text: "Has skills in Jira and MS Project." }),
  // #323: the CV gives two values for one field — a conflict the review settles once.
  claim({ id: "city-paris", semantic_key: "city", field_key: "city", field_value: "Paris", field_label: "City", text: "Based in Paris." }),
  claim({ id: "city-lyon", semantic_key: "city", field_key: "city", field_value: "Lyon", field_label: "City", text: "Based in Lyon." }),
];
const fakePipeline = () => ({ mine: async () => ({ doc: null, claims: MINED, roles: 2, needsGrill: 0 }) });

const decision = (value: string) => ({ value, source_quote: value, machine_touch: "verbatim" as const, classification: "Verified" as const });
function block(id: string, employer: string, title: string, startYear: number, end: MinedJobBlock["end"]["value"]): MinedJobBlock {
  return {
    id,
    employer: decision(employer),
    title: decision(title),
    start: { value: { year: startYear, month: 3, precision: "month" }, source_quote: `Mar ${startYear}`, machine_touch: "verbatim", classification: "Verified" },
    end: end.state === "unknown"
      ? { value: end, source_quote: null, machine_touch: "inferred", classification: "Derived" }
      : { value: end, source_quote: "x", machine_touch: "verbatim", classification: "Verified" },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}
const BLOCKS: MinedJobBlock[] = [
  block("nrg", "Nordic Retail Group", "IT Project Manager", 2021, { state: "ongoing" }),
  block("bsh", "Baltic Software House", "Project Coordinator", 2017, { state: "unknown" }),
];

const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const put = (app: App, cookie: string, url: string, payload: unknown) => app.inject({ method: "PUT", url, headers: { cookie }, payload });
const review = async (app: App, cookie: string) => (await get(app, cookie, "/review")).json() as ReviewState;
const jobsOf = (state: ReviewState) => {
  const experience = state.sections.find((s) => s.tag === "experience");
  return experience && "jobs" in experience ? experience.jobs : [];
};
const linesOf = (state: ReviewState, tag: string) => {
  const section = state.sections.find((s) => s.tag === tag);
  return section && "lines" in section ? section.lines : [];
};

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}
async function settled(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (isTerminal(job.status)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job never settled");
}

/** A session that brought a CV: pasted → mined (fake) → its dated job records seeded. */
async function withCv(opts: Parameters<typeof buildServer>[0] = {}) {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  await jobBlocks.init();
  const server = buildServer({ pipeline: fakePipeline(), jobBlocks, eligibility, ...opts });
  const { app } = server;
  const cookie = await anonSession(app);
  const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
  const { jobId } = (await post(app, cookie, "/cv/paste", { text: CV_TEXT })).json();
  await settled(app, cookie, jobId);
  await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks: BLOCKS }, "{}");
  await refreshWorkedYears(jobBlocks, eligibility, sessionId);
  return { server, app, cookie, sessionId, jobBlocks, eligibility };
}

/** Answers question 1 and signs in, so the review is the only thing between the session and its jobs
 *  (#339: there is no floor left to earn). */
async function pastDiscovery(app: App, cookie: string, email: string) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await signIn(app, cookie, email);
}

describe("#338 the paper", () => {
  it("letterhead first, then each job with its lines as read — ticked, in CV order, dated from the job records", async () => {
    const { app, cookie } = await withCv();
    const state = await review(app, cookie);

    expect(state.completed).toBe(false);
    // #381: the letterhead as Your details' five fields; this CV has a city but no title.
    expect(state.letterhead).toEqual({
      name: { value: "Jane Doe", origin: "read" },
      title: null,
      email: { value: "jane.doe.338@example.com", origin: "read" },
      phone: { value: "+33 6 00 00 00 00", origin: "read" },
      location: { value: "Paris, France", origin: "read" },
    });

    // The master CV's own print order: summary, experience, personal projects, skills, certifications,
    // education, languages, additional information (#373 added the two the summary used to swallow).
    expect(state.sections.map((s) => s.tag)).toEqual(["profile", "experience", "project", "skill", "cert", "edu", "lang", "additional"]);
    const jobs = jobsOf(state);
    expect(jobs.map((j) => [j.employer, j.title])).toEqual([
      ["Nordic Retail Group", "IT Project Manager"],
      ["Baltic Software House", "Project Coordinator"],
    ]);
    expect(jobs[0]!.dates).toEqual({ start: "Mar 2021", end: "now" });
    // No review model wired on this server: the lines as read, no marks, no run — the state #341's
    // silent failure also shows.
    expect(state.progress).toBeNull();
    expect(jobs[0]!.checking).toBe(false);
    expect(jobs[0]!.lines).toEqual([
      { id: "nrg-led-checkout", text: "Led the checkout replatform.", state: "ticked", fix: null, suggestion: null, draft: null, movedFrom: null },
      { id: "nrg-managed-budget", text: "Managed a budget of EUR 1.2M across 3 vendor teams.", state: "ticked", fix: null, suggestion: null, draft: null, movedFrom: null },
    ]);
    expect(jobs[0]).toMatchObject({ family: null }); // no run: no family read back
    expect(jobs[1]!.lines.map((l) => l.id)).toEqual(["bsh-coordinated-releases"]);
    expect(linesOf(state, "edu").map((l) => l.id)).toEqual(["edu-msc-mis-warsaw"]);
    expect(linesOf(state, "skill").map((l) => l.id)).toEqual(["skill-tools"]);
  });

  it("untick moves a line to kept and re-tick restores it — both read back from the server", async () => {
    const { app, cookie } = await withCv();
    expect((await put(app, cookie, "/cv/lines/nrg-managed-budget", { state: "kept" })).statusCode).toBe(200);
    expect(jobsOf(await review(app, cookie))[0]!.lines[1]).toMatchObject({ id: "nrg-managed-budget", state: "kept" });
    expect((await put(app, cookie, "/cv/lines/nrg-managed-budget", { state: "ticked" })).statusCode).toBe(200);
    expect(jobsOf(await review(app, cookie))[0]!.lines[1]).toMatchObject({ id: "nrg-managed-budget", state: "ticked" });
  });

  it("refuses the review to no session", async () => {
    const { app } = await withCv();
    expect((await app.inject({ method: "GET", url: "/review" })).statusCode).toBe(401);
  });
});

describe("#338 the end date, asked on the job's own card", () => {
  it("a job with no end date asks for it there, and nowhere in discovery", async () => {
    const { app, cookie } = await withCv();
    const jobs = jobsOf(await review(app, cookie));
    expect(jobs[0]!.endDateQuestion).toBeNull();
    expect(jobs[1]).toMatchObject({
      blockId: "bsh",
      dates: { start: "Mar 2017", end: null },
      endDateQuestion: "When did you leave Baltic Software House?",
    });
    const discovery = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(discovery.questions.filter((q: { itemId: string }) => q.itemId.startsWith("job-date-"))).toEqual([]);
  });

  it("an answer corrects the record, closes the question and feeds years of experience", async () => {
    const { app, cookie, sessionId, eligibility, jobBlocks } = await withCv();
    const before = await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY);

    expect((await post(app, cookie, "/review/jobs/bsh/end", { answer: "March 2021" })).statusCode).toBe(200);

    const bsh = jobsOf(await review(app, cookie))[1]!;
    expect(bsh.dates).toEqual({ start: "Mar 2017", end: "Mar 2021" });
    expect(bsh.endDateQuestion).toBeNull();
    const stored = (await jobBlocks.list(sessionId)).find((b) => b.id === "bsh")!;
    expect(stored.end.value).toEqual({ state: "ended", date: { year: 2021, month: 3, precision: "month" } });
    expect(stored.end.origin.kind).toBe("corrected");
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(before + 4); // exactly 48 months more
  });

  it("refuses an answer it cannot read, and an unknown job, storing nothing", async () => {
    const { app, cookie, sessionId, jobBlocks } = await withCv();
    expect((await post(app, cookie, "/review/jobs/bsh/end", { answer: "ages ago" })).statusCode).toBe(400);
    expect((await post(app, cookie, "/review/jobs/no-such-job/end", { answer: "2020" })).statusCode).toBe(404);
    expect((await jobBlocks.list(sessionId)).find((b) => b.id === "bsh")!.end.value).toEqual({ state: "unknown" });
    expect(jobsOf(await review(app, cookie))[1]!.endDateQuestion).toBe("When did you leave Baltic Software House?");
  });
});

describe("#338 an import conflict, settled once", () => {
  it("shows the conflict on the paper, with both values as read", async () => {
    const { app, cookie } = await withCv();
    const state = await review(app, cookie);
    expect(state.conflict).toEqual({
      fieldId: "city",
      question: "City: your CV says Paris and also Lyon. Which one is right?",
      values: ["Paris", "Lyon"],
    });
    // Both values stay on the paper as read until the person picks — or forever, on "Not sure".
    expect(linesOf(state, "profile").map((l) => l.text)).toEqual(["Based in Paris.", "Based in Lyon."]);
  });

  it("the pick is recorded as the person's resolution; the picked line stays, the other goes", async () => {
    const { app, cookie, server, sessionId } = await withCv();
    expect((await post(app, cookie, "/review/conflicts/city", { value: "Paris" })).statusCode).toBe(200);

    const state = await review(app, cookie);
    expect(state.conflict).toBeNull();
    expect(linesOf(state, "profile").map((l) => l.text)).toEqual(["Based in Paris."]);
    const session = (await server.sessions.getById(sessionId))!;
    expect(session.importResolutions).toEqual({ city: "Paris" });
    expect(session.importProof?.conflict).toBeNull();
    // Settled once: the same question is not open any more.
    expect((await post(app, cookie, "/review/conflicts/city", { value: "Lyon" })).statusCode).toBe(404);
  });

  it("left open with \"Not sure\", finishing the review prints neither reading; settling afterwards prints the pick", async () => {
    const { app, cookie } = await withCv();
    await pastDiscovery(app, cookie, "review-conflict-open@example.com");
    await post(app, cookie, "/review/complete");

    const built = (await post(app, cookie, "/onboarding/build")).json();
    expect(built.rootCv.markdown).toContain("Led the checkout replatform."); // the rest of the CV is confirmed
    expect(built.rootCv.markdown).not.toContain("Based in Paris.");
    expect(built.rootCv.markdown).not.toContain("Based in Lyon.");
    // Both readings are still on the paper, as read, for the person to settle whenever they like.
    expect(linesOf(await review(app, cookie), "profile").map((l) => l.text)).toEqual(
      expect.arrayContaining(["Based in Paris.", "Based in Lyon."]),
    );

    await post(app, cookie, "/review/conflicts/city", { value: "Lyon" });
    const settled = (await post(app, cookie, "/onboarding/build")).json();
    expect(settled.rootCv.markdown).toContain("Based in Lyon.");
    expect(settled.rootCv.markdown).not.toContain("Based in Paris.");
  });

  it("refuses a value the CV never gave, and an unknown field", async () => {
    const { app, cookie } = await withCv();
    expect((await post(app, cookie, "/review/conflicts/city", { value: "Berlin" })).statusCode).toBe(400);
    expect((await post(app, cookie, "/review/conflicts/degree", { value: "MSc" })).statusCode).toBe(404);
    expect((await review(app, cookie)).conflict?.values).toEqual(["Paris", "Lyon"]);
  });
});

describe("#338 the jobs gate — review completed", () => {
  it("the deck, the want door and the tailor refuse until the review is completed, and open after", async () => {
    const { app, cookie } = await withCv();
    await pastDiscovery(app, cookie, "review-gate@example.com");

    // Discovery tells the screen where its last answer hands off: the review, not the jobs.
    expect((await get(app, cookie, "/onboarding/discovery")).json()).toMatchObject({ reviewPending: true });

    const held = (await get(app, cookie, "/onboarding/cards")).json();
    expect(held).toMatchObject({ reviewPending: true, cards: [], searching: false });
    expect(held.retrieval).toBeUndefined(); // no provider was asked for a deck nobody may see
    expect((await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`)).statusCode).toBe(404);
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(409);

    expect((await post(app, cookie, "/review/complete")).json()).toEqual({ completed: true });

    expect((await get(app, cookie, "/onboarding/discovery")).json()).toMatchObject({ reviewPending: false });
    const deck = (await getCardsWhenRetrieved(app, cookie)).json();
    expect(deck.reviewPending).toBeUndefined();
    expect(deck.cards.length).toBeGreaterThan(0);
    expect((await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`)).json()).toMatchObject({ stage: "tailor" });
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(200);
  });

  it("holds a job the person brought as well — at the one door every posting reader passes through, and on the job's own screen", async () => {
    // The #248 gate lets a brought job through (it was never fetched); the review gate does not —
    // a pasted job is matched against the same unreviewed CV. Driven at the shared predicate, which
    // every reader (deck, want, tailor) composes.
    const brought = [{ posting: { id: "posting:x", title: "PM", company: "Acme", location: "Paris", keywords: [], excerpt: "", language: "en" } }] as unknown as BroughtJob[];
    const base = { retrieval: null, discovery: { questionFloors: [], searchFamily: null, coveredItemIds: [], checkpoint: null, fallback: { declined: false, family: null } } } as unknown as Pick<SessionRecord, "retrieval" | "discovery">;
    const proof = { outcome: "success", usefulFactCount: 1, representativeFacts: [], conflict: null } as SessionRecord["importProof"];
    expect(sessionPostings({ ...base, importProof: proof, reviewCompletedAt: null }, "fp", brought)).toEqual([]);
    expect(sessionPostings({ ...base, importProof: proof, reviewCompletedAt: "2026-10-06T00:00:00.000Z" }, "fp", brought)).toHaveLength(1);
    expect(sessionPostings({ ...base, importProof: null, reviewCompletedAt: null }, "fp", brought)).toHaveLength(1);

    const { app, cookie } = await withCv();
    const screen = await get(app, cookie, "/onboarding/jobs/posting:x");
    expect(screen.statusCode).toBe(409);
    expect(screen.json().error.code).toBe("review_pending");
  });

  it("a session with no CV has nothing to review and is never held", async () => {
    const server = buildServer();
    const { app } = server;
    const cookie = await anonSession(app);
    await pastDiscovery(app, cookie, "review-nocv@example.com");
    expect((await get(app, cookie, "/onboarding/discovery")).json()).toMatchObject({ reviewPending: false });
    const deck = (await getCardsWhenRetrieved(app, cookie)).json();
    expect(deck.reviewPending).toBeUndefined();
    expect(deck.cards.length).toBeGreaterThan(0);
  });

  it("completing confirms the lines as read: ticked ones print on the master CV, a kept one does not", async () => {
    const { app, cookie } = await withCv();
    await pastDiscovery(app, cookie, "review-prints@example.com");
    await put(app, cookie, "/cv/lines/nrg-managed-budget", { state: "kept" });
    await post(app, cookie, "/review/complete");

    const built = (await post(app, cookie, "/onboarding/build")).json();
    expect(built.rootCv.markdown).toContain("Led the checkout replatform.");
    expect(built.rootCv.markdown).toContain("Coordinated releases for 4 agile squads.");
    expect(built.rootCv.markdown).not.toContain("Managed a budget of EUR 1.2M");
  });

  it("the review can be reopened after completion; a change made there persists and the jobs stay open", async () => {
    const { app, cookie } = await withCv();
    await pastDiscovery(app, cookie, "review-reopen@example.com");
    await post(app, cookie, "/review/complete");

    const reopened = await review(app, cookie);
    expect(reopened.completed).toBe(true);
    expect(jobsOf(reopened)[0]!.lines.every((l) => l.state === "ticked")).toBe(true);
    await put(app, cookie, "/cv/lines/nrg-led-checkout", { state: "kept" });
    expect(jobsOf(await review(app, cookie))[0]!.lines[0]).toMatchObject({ id: "nrg-led-checkout", state: "kept" });
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200); // confirming again moves nothing
    expect((await getCardsWhenRetrieved(app, cookie)).json().cards.length).toBeGreaterThan(0);
  });
});

// --- #376 work rights and languages, in check mode -------------------------------------------
// ADR-0018 clauses 5, 7, 8: the start asks nothing after the upload, so "Where you can work" is a
// plain card on check mode's Additional information screen — one row per target market, pre-filled
// from what the CV implies and answered by the person — and the jobs wait until every market has
// an answer. Languages are their own screen; a CV with none gets a card asking which they speak.
// Driven over HTTP: GET /review is the card's one read, the review doors are its writes, and
// POST /review/complete is the gate.
describe("#376 where you can work, on check mode's last screen", () => {
  const NATIONALITY = "Nationality: Australian, based in Hong Kong.";
  async function withMarkets(areas: string[], opts: Parameters<typeof withCv>[0] = {}) {
    const cv = await withCv(opts);
    await cv.server.claims.add(cv.sessionId, claim({ id: "nationality", text: NATIONALITY }));
    if (areas.length > 0) await put(cv.app, cv.cookie, "/sessions/me/intent", { searchAreas: areas });
    return cv;
  }

  it("one row per target market, in chip order: the CV's nationality proposes yes for its own country, the rest stay open, and nothing is stored", async () => {
    const { app, cookie, sessionId, eligibility } = await withMarkets(["Hong Kong", "Sydney", "Melbourne"]);
    const state = await review(app, cookie);
    expect(state.workRights).toEqual([
      { market: "Hong Kong", itemId: "eligibility-work-rights-hong-kong", answer: null, proposed: null, note: null, source: null },
      {
        market: "Australia",
        itemId: "eligibility-work-rights-australia",
        answer: null,
        proposed: "eligible",
        note: "You're Australian, so I put yes.",
        source: NATIONALITY,
      },
    ]);
    // A proposal is shown, never stored (ADR-0013 clause 3): no work-rights fact exists yet.
    expect((await eligibility.list(sessionId)).filter((f) => f.dimension === "work-rights")).toEqual([]);
  });

  it("the jobs wait: finishing is refused naming each open market, the card's door answers one market at a time, then finishing goes through", async () => {
    const { app, cookie, sessionId, eligibility } = await withMarkets(["Hong Kong", "Sydney"]);
    await pastDiscovery(app, cookie, "work-rights-gate@example.com");

    const refused = await post(app, cookie, "/review/complete");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: "work_rights_unset" });
    expect(refused.json().error.message).toContain("Hong Kong and Australia");
    expect((await review(app, cookie)).completed).toBe(false);
    // The refusal confirmed nothing: the lines as read are still the person's to check.
    expect((await get(app, cookie, "/onboarding/cards")).json()).toMatchObject({ reviewPending: true, cards: [] });

    // The proposal for Australia is not an answer: until it is tapped, Australia still holds the jobs.
    const [hk, au] = (await review(app, cookie)).workRights;
    expect(au).toMatchObject({ proposed: "eligible", answer: null });
    expect((await put(app, cookie, `/review/work-rights/${hk!.itemId}`, { answer: "needs-sponsorship" })).statusCode).toBe(200);
    const stillOpen = await post(app, cookie, "/review/complete");
    expect(stillOpen.json().error.message).toContain("Australia");
    expect(stillOpen.json().error.message).not.toContain("Hong Kong");

    expect((await put(app, cookie, `/review/work-rights/${au!.itemId}`, { answer: "eligible" })).json()).toEqual({ ok: true });
    expect((await review(app, cookie)).workRights.map((r) => [r.market, r.answer])).toEqual([
      ["Hong Kong", "needs-sponsorship"],
      ["Australia", "eligible"],
    ]);
    // Stored in the store's own words, under the key every other reader uses.
    expect(await eligibility.get(sessionId, "work-rights", "australia")).toMatchObject({ value: "eligible" });
    expect(await eligibility.get(sessionId, "work-rights", "hong-kong")).toMatchObject({ value: "needs-sponsorship" });

    expect((await post(app, cookie, "/review/complete")).json()).toEqual({ completed: true });
    expect((await getCardsWhenRetrieved(app, cookie)).json().cards.length).toBeGreaterThan(0);
  });

  it("the door answers only this session's markets, and only in the store's two words", async () => {
    const { app, cookie } = await withMarkets(["Hong Kong"]);
    expect((await put(app, cookie, "/review/work-rights/eligibility-work-rights-australia", { answer: "eligible" })).statusCode).toBe(404);
    expect((await put(app, cookie, "/review/work-rights/eligibility-languages", { answer: "eligible" })).statusCode).toBe(404);
    expect((await put(app, cookie, "/review/work-rights/eligibility-work-rights-hong-kong", { answer: "Yes" })).statusCode).toBe(400);
    expect((await review(app, cookie)).workRights[0]!.answer).toBeNull();
  });

  // A CV pasted with no target area yet is a real path (the paste door): nothing can be asked, so
  // nothing may hold the jobs on it.
  it("with no target market there is no row, and finishing is allowed", async () => {
    const { app, cookie } = await withMarkets([]);
    await pastDiscovery(app, cookie, "work-rights-none@example.com");
    expect((await review(app, cookie)).workRights).toEqual([]);
    expect((await post(app, cookie, "/review/complete")).json()).toEqual({ completed: true });
  });

  // ADR-0018 / #376 AC4: an answer given before — on discovery, before it stopped asking — is kept
  // and counts. Nothing deletes an eligibility fact; this session never sees the card unanswered.
  it("an answer given before check mode existed is kept: the row reads it and the gate lets the session through", async () => {
    const { app, cookie, sessionId, eligibility } = await withMarkets(["Hong Kong"]);
    await pastDiscovery(app, cookie, "work-rights-earlier@example.com");
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "eligibility-work-rights-hong-kong", answer: "Yes — no sponsorship needed" });
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: "eligibility-languages", answers: ["English"] });
    expect((await review(app, cookie)).workRights).toMatchObject([{ market: "Hong Kong", answer: "eligible" }]);
    expect((await post(app, cookie, "/review/complete")).json()).toEqual({ completed: true });
    expect(await eligibility.get(sessionId, "language", "English")).toMatchObject({ value: "declared" });
  });
});

describe("#376 languages, their own screen", () => {
  it("the CV's languages are the section's lines; with none, the card's door stores what the person names and the walk reads it back", async () => {
    const { app, cookie, sessionId, eligibility } = await withCv();
    const before = await review(app, cookie);
    expect(linesOf(before, "lang")).toEqual([]); // the fixture CV lists no languages
    expect(before.languages).toEqual([]);
    // The card completes from the product's own language list (languages-by-market.json), so the
    // completions grow with the data, never with the screen.
    expect(before.languageOptions).toEqual([...languagesUnion()]);
    expect(before.languageOptions.length).toBeGreaterThan(0);

    const saved = await put(app, cookie, "/review/languages", { languages: ["English", "Polish"] });
    expect(saved.json()).toEqual({ ok: true });
    expect((await review(app, cookie)).languages).toEqual(["English", "Polish"]);
    expect(await eligibility.get(sessionId, "language", "Polish")).toMatchObject({ value: "declared" });

    // Correcting the list keeps the same door: a dropped language goes back to unknown, never "no".
    await put(app, cookie, "/review/languages", { languages: ["English"] });
    expect((await review(app, cookie)).languages).toEqual(["English"]);
    expect(await eligibility.get(sessionId, "language", "Polish")).toBeNull();
    expect((await put(app, cookie, "/review/languages", { languages: ["   "] })).statusCode).toBe(400); // not a word: refused, nothing stored
    expect((await review(app, cookie)).languages).toEqual(["English"]);
  });

  it("a CV that lists languages shows them as the section's lines", async () => {
    const { app, cookie, server, sessionId } = await withCv();
    await server.claims.add(sessionId, claim({ id: "lang-polish", text: "Polish (Native)" }));
    expect(linesOf(await review(app, cookie), "lang").map((l) => l.text)).toEqual(["Polish (Native)"]);
  });
});
