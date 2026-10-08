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
    expect(state.letterhead.header).toContain("Jane Doe");
    expect(state.letterhead.email).toEqual({ value: "jane.doe.338@example.com", origin: "read" });
    expect(state.letterhead.phone?.origin).toBe("read");

    // The master CV's own print order: summary, experience, skills, certifications, education, languages.
    expect(state.sections.map((s) => s.tag)).toEqual(["profile", "experience", "skill", "cert", "edu", "lang"]);
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
      { id: "nrg-led-checkout", text: "Led the checkout replatform.", state: "ticked", fix: null, suggestion: null, draft: null },
      { id: "nrg-managed-budget", text: "Managed a budget of EUR 1.2M across 3 vendor teams.", state: "ticked", fix: null, suggestion: null, draft: null },
    ]);
    expect(jobs[0]).toMatchObject({ family: null, complete: false }); // no run: no family read back, no stamp
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
