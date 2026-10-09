// #341 — the review runs in the background (ADR-0016 clauses 2, 3, 5 and 7). Driven over HTTP (the
// spec's main seam) with the QA stack's own fake writer (qaReviewAnswer.ts), which derives every
// answer from the prompt it is handed: a line containing "accross" gets a fix, a line containing
// "intended to" gets an untick suggestion, everything else is kept. What it proves:
//   - the run starts from the pipeline, once the lines and placements are stored, before anyone
//     opens the review — one call per job, the sections riding on the first;
//   - fixes are applied by default, listed original → corrected, undone to the EXACT original and
//     usable again; suggestions show their reason and move nothing; a job in no published family
//     gets both;
//   - generated once: later reads, the confirm and a reopen never re-call the writer;
//   - a mid-run failure is retried for that job alone; a writer that stays down leaves the lines
//     as read, the person can finish, and nothing on the wire says so;
//   - the confirm is refused while the run is going, and the progress counts the jobs that landed;
//   - a fix or judgement naming a line the model was not shown is dropped;
//   - a run a restart left going is resumed on the first read, for its unfinished units only.
// #362 — a failed run is reopened by a later read and retried quietly, within four paid attempts
// per job over its whole life; never once the person confirmed. The wire's `unchecked` says a part
// has no answer, so the screen never claims a finished check.
// #342 — drafted lines (ADR-0016 clause 4), over the same seam; the fake drafts one line per
// must-have the placed job does not show, plus an OPTIONAL and an INDUSTRY GUESS line. What it proves:
//   - drafts arrive unticked at the end of their job, each with its source and flags; a job in no
//     published family gets none;
//   - an unticked draft never reaches the master CV, a tailored draft or an export; ticked, it reaches
//     all three; unticked again, it stops (remove `prints`' ticked check and these go red);
//   - the edit before the tick stores the person's wording; the tick makes it a confirmed,
//     drafted-then-accepted fact; the wrong doors refuse;
//   - a job whose lines show every must-have reads complete and gets no draft;
//   - a reload shows the same wording and never re-calls the writer; the two drafts the prompt forbids
//     (no source; a job in no family) are dropped and counted.
// #343 — word choices, over the same seam: a draft's vague phrases arrive with the stored review, CV
// options first (the fake lists them typical-first); a pick or typed words saved through the draft's
// edit door read back on a reload and print once ticked; none of it asks the writer.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CandidateClaim, MinedJobBlock } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer, IT_PROJECT_DELIVERY_PLACEMENT } from "./placedServer.js";
import { getCardsWhenRetrieved, liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { isTerminal } from "../src/jobs.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore } from "../src/eligibility.js";
import type { LlmClient } from "../src/llm.js";
import type { Mailer } from "../src/mailer.js";
import { StandInDocumentMaker, type DocumentMaker } from "../src/documentMaker.js";
import type { ReviewLine, ReviewState } from "../src/cvReview.js";
import { keepAliveOverHttp, parseReviewAnswer } from "../src/cvReviewRun.js";
import { parseReviewPrompt, qaReviewAnswer } from "../src/qaReviewAnswer.js";
import { readCounters, resetCountersForTest } from "../src/counters.js";

type Server = ReturnType<typeof buildServer>;
type App = Server["app"];

const ROLE = "IT project manager in Paris";
const NOW = Date.parse("2026-10-08T09:00:00.000Z");

const CV_TEXT = [
  "Jane Doe",
  "+33 6 00 00 00 00 | jane.doe.341@example.com",
  "Paris, France",
  "",
  "EXPERIENCE",
  "IT Project Manager, Nordic Retail Group — Mar 2021 - Present",
  "- Led the checkout replatform.",
  "- Managed a budget of EUR 1.2M accross 3 vendor teams.",
  "",
  "Project Coordinator, Baltic Software House — Jun 2017 - Feb 2021",
  "- Coordinated releases for 4 agile squads.",
  "- Set up a release calendar intended to cut slippage.",
  "",
  "SKILLS",
  "Jira, MS Projcet",
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
const TYPO_LINE = "Managed a budget of EUR 1.2M accross 3 vendor teams.";
const FIXED_LINE = "Managed a budget of EUR 1.2M across 3 vendor teams.";
const AIM_LINE = "Set up a release calendar intended to cut slippage.";
const MINED: CandidateClaim[] = [
  claim({ id: "sum-pm", text: "Delivery-accountable project manager." }),
  claim({ id: "nrg-led-checkout", role: NRG, text: "Led the checkout replatform." }),
  claim({ id: "nrg-managed-budget", role: NRG, text: TYPO_LINE }),
  claim({ id: "bsh-coordinated-releases", role: BSH, text: "Coordinated releases for 4 agile squads." }),
  claim({ id: "bsh-release-calendar", role: BSH, text: AIM_LINE }),
  claim({ id: "skill-tools", text: "Has skills in Jira and MS Projcet." }),
];

const decision = (value: string) => ({ value, source_quote: value, machine_touch: "verbatim" as const, classification: "Verified" as const });
function block(id: string, employer: string, title: string, startYear: number, end: MinedJobBlock["end"]["value"]): MinedJobBlock {
  return {
    id,
    employer: decision(employer),
    title: decision(title),
    start: { value: { year: startYear, month: 3, precision: "month" }, source_quote: `Mar ${startYear}`, machine_touch: "verbatim", classification: "Verified" },
    end: { value: end, source_quote: "x", machine_touch: "verbatim", classification: "Verified" },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}
const BLOCKS: MinedJobBlock[] = [
  block("nrg", "Nordic Retail Group", "IT Project Manager", 2021, { state: "ongoing" }),
  block("bsh", "Baltic Software House", "Project Coordinator", 2017, { state: "ended", date: { year: 2021, month: 2, precision: "month" } }),
];

// ---------------------------------------------------------------------------------------------
// The fake writer: the QA stack's own answer (qaReviewAnswer.ts — one dialect for both), wrapped
// with what a test needs — a call log, a hold per job, a failure on the first attempt or on every one.
// ---------------------------------------------------------------------------------------------
interface WriterOpts {
  /** Prompt job ids (j1, j2) whose FIRST attempt fails. */
  failFirst?: string[];
  failAlways?: boolean;
  /** #362: every job's first N attempts fail. */
  failAttempts?: number;
  /** Also name a line the model was never shown — the guard against it is what the test watches. */
  bogus?: boolean;
  /** #342: also draft the two lines the prompt forbids (qaReviewAnswer.ts). */
  badDrafts?: boolean;
}
function fakeWriter(opts: WriterOpts = {}) {
  const calls: string[] = [];
  const attempts = new Map<string, number>();
  const gates = new Map<string, { wait: Promise<void>; open: () => void }>();
  const llm: LlmClient = {
    model: "fake-review",
    async complete(prompt) {
      calls.push(prompt);
      const asked = parseReviewPrompt(prompt).toReview.filter((id) => id !== "sections");
      const key = asked[0] ?? "sections";
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      const gate = gates.get(key);
      if (gate) await gate.wait;
      // The shape undici gives a connection dropped mid-stream: a bare message, the reason in `cause`.
      if (opts.failAlways || n <= (opts.failAttempts ?? 0) || (n === 1 && opts.failFirst?.includes(key))) throw new Error("writer down", { cause: new Error("other side closed") });
      return qaReviewAnswer(prompt, { bogus: opts.bogus, badDrafts: opts.badDrafts });
    },
  };
  return {
    llm,
    calls,
    /** Holds every call for `key` until release(key). */
    hold(key: string) {
      let open!: () => void;
      const wait = new Promise<void>((r) => (open = r));
      gates.set(key, { wait, open });
    },
    release(key: string) {
      gates.get(key)?.open();
      gates.delete(key);
    },
    asked: () => calls.map((p) => /=== JOBS TO REVIEW ===\n(.+)/.exec(p)![1]),
  };
}

// ---------------------------------------------------------------------------------------------
// HTTP helpers.
// ---------------------------------------------------------------------------------------------
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
const allLines = (state: ReviewState) => [...jobsOf(state).flatMap((j) => j.lines), ...state.sections.flatMap((s) => ("lines" in s ? s.lines : []))];

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}
/** Polls on setImmediate (fixtureDeck.ts's rule: never a timer a test may fake). */
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string): Promise<T> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`never happened: ${what}`);
}
const reviewed = (app: App, cookie: string) => until(() => review(app, cookie), (s) => s.progress === null, "the run finished");

/** A session that brought a CV: pasted → mined (fake) → dated job records mined and the first one
 *  placed (fake) → the review run started by the pipeline over the fake writer. */
async function withCv(writer: ReturnType<typeof fakeWriter>, mined: CandidateClaim[] = MINED, opts: Parameters<typeof buildServer>[0] = {}) {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  await jobBlocks.init();
  const server = buildServer({
    pipeline: {
      mine: async () => ({ doc: null, claims: mined, roles: 2, needsGrill: 0 }),
      mineJobBlocks: async () => ({ doc: { schemaVersion: "1", blocks: BLOCKS, parser_flags: [] }, rawOutput: "{}" }),
      labelJobBlocks: async (sessionId) => {
        await jobBlocks.label(sessionId, "nrg", IT_PROJECT_DELIVERY_PLACEMENT);
      },
    },
    jobBlocks,
    eligibility,
    reviewLlm: writer.llm,
    reviewRun: { retryDelayMs: 0, now: () => NOW },
    ...opts,
  });
  const { app } = server;
  const cookie = await anonSession(app);
  const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
  const { jobId } = (await post(app, cookie, "/cv/paste", { text: CV_TEXT })).json();
  await until(async () => (await get(app, cookie, `/jobs/${jobId}`)).json(), (job) => isTerminal(job.status), "the paste settled");
  return { server, app, cookie, sessionId };
}

beforeEach(() => resetCountersForTest());

describe("#341 the run", () => {
  it("starts from the pipeline — before anyone opens the review — one call per job, sections on the first; fixes applied, suggestions shown, a job with no family included", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    // Nothing has read /review yet: the writer was asked anyway, once per job.
    await until(() => writer.calls.length, (n) => n === 2, "two writer calls");
    expect(writer.asked().sort()).toEqual(["j2", "sections, j1"]);

    const first = writer.calls.find((p) => p.includes("sections, j1"))!;
    expect(first).toContain("=== JOB FAMILIES ===\n- id: it-project-delivery\n  label: IT Project Manager");
    expect(first).toContain("  - end-to-end-delivery: Have you owned delivery from planning through completion?");
    expect(first).toContain("- j1: IT Project Manager — Nordic Retail Group → it-project-delivery");
    expect(first).toContain("- j2: Project Coordinator — Baltic Software House → none");
    expect(first).toContain("# Jane Doe");
    expect(first).toContain("### IT Project Manager — Nordic Retail Group (j1)\n**Mar 2021 – now**\n\n- [nrg-led-checkout] Led the checkout replatform.\n- [nrg-managed-budget] " + TYPO_LINE);
    expect(first).toContain("## Skills\n\n- [skill-tools] Has skills in Jira and MS Projcet.");
    expect(first.startsWith("You review a candidate's CV, job by job")).toBe(true); // the shipped prompt, header comment stripped

    const state = await reviewed(app, cookie);
    const [nrg, bsh] = jobsOf(state);
    expect(nrg!.checking).toBe(false);
    // The fix: applied by default — the line reads the corrected text — and listed original → corrected.
    expect(nrg!.lines[1]).toEqual({
      id: "nrg-managed-budget",
      text: FIXED_LINE,
      state: "ticked",
      fix: { original: TYPO_LINE, corrected: FIXED_LINE, applied: true },
      suggestion: null,
      draft: null,
    });
    expect(nrg!.lines[0]!.fix).toBeNull();
    // The suggestion, on a job placed in no family: shown with its reason, the line still ticked.
    expect(bsh!.lines[1]).toEqual({
      id: "bsh-release-calendar",
      text: AIM_LINE,
      state: "ticked",
      fix: null,
      suggestion: { kind: "aim-without-result", reason: "States an aim and no delivered result." },
      draft: null,
    });
    // A fix outside the jobs — the skills section — lands where the line sits.
    expect(linesOf(state, "skill")[0]).toMatchObject({ text: "Has skills in Jira and MS Project.", fix: { applied: true } });
    expect(linesOf(state, "profile")[0]!.fix).toBeNull();
  });

  it("generated once: later reads, the confirm and a reopen never re-call the writer", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    await reviewed(app, cookie);
    const spent = writer.calls.length;
    await review(app, cookie);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-once@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    expect((await review(app, cookie)).completed).toBe(true);
    expect(writer.calls.length).toBe(spent);
    // The fix reaches the master CV: what prints is the corrected line.
    const built = (await post(app, cookie, "/onboarding/build")).json();
    expect(built.rootCv.markdown).toContain(FIXED_LINE);
    expect(built.rootCv.markdown).not.toContain("accross");
  });

  it("a mid-run failure is retried for that job alone — the other job's answer is never re-asked", async () => {
    const writer = fakeWriter({ failFirst: ["j2"] });
    const { app, cookie, server, sessionId } = await withCv(writer);
    const state = await reviewed(app, cookie);
    expect(writer.asked().sort()).toEqual(["j2", "j2", "sections, j1"]);
    expect(jobsOf(state)[0]!.lines[1]!.fix?.applied).toBe(true);
    expect(jobsOf(state)[1]!.lines[1]!.suggestion?.kind).toBe("aim-without-result");
    // #364: why the first attempt failed is kept on the unit, past the retry that answered — with
    // the error's cause, which is all a dropped connection says about itself.
    expect((await server.cvReviews.get(sessionId))!.units).toMatchObject([
      { unit: "nrg", failures: 0, lastError: null },
      { unit: "bsh", failures: 1, lastError: "writer down (cause: other side closed)" },
    ]);
  });

  it("#362: a failed run is retried quietly on a later read — the person gets the review", async () => {
    const writer = fakeWriter({ failAttempts: 2 });
    const { app, cookie, server, sessionId } = await withCv(writer);
    await until(() => server.cvReviews.get(sessionId), (run) => run?.outcome === "failed", "the first run gave up");
    expect(writer.calls.length).toBe(4); // two attempts each

    const reopened = await review(app, cookie);
    expect(reopened.progress).toEqual({ done: 0, total: 2, minutesLeft: 5 }); // read as checking again
    expect(reopened.unchecked).toBe(true);
    const state = await reviewed(app, cookie);
    expect(writer.calls.length).toBe(6);
    expect(jobsOf(state)[0]!.lines[1]!.fix?.applied).toBe(true);
    expect(state.unchecked).toBe(false);
    expect((await server.cvReviews.get(sessionId))?.outcome).toBe("done");
  });

  it("#362: a review the person already confirmed is never retried — no line they signed off moves", async () => {
    const writer = fakeWriter({ failAlways: true });
    const { app, cookie, server, sessionId } = await withCv(writer);
    await until(() => server.cvReviews.get(sessionId), (run) => run?.outcome === "failed", "the first run gave up");
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-confirmed@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    const state = await review(app, cookie);
    expect(state.progress).toBeNull();
    expect(writer.calls.length).toBe(4);
  });

  it("when the writer stays down, the lines show as read, the person can finish, and nothing on the wire says so", async () => {
    const writer = fakeWriter({ failAlways: true });
    const { app, cookie, server, sessionId } = await withCv(writer);
    const state = await reviewed(app, cookie);
    // Two attempts each, retried once on a later read (#362) — four paid attempts per job, then no more.
    expect(writer.asked().sort()).toEqual(["j2", "j2", "j2", "j2", "sections, j1", "sections, j1", "sections, j1", "sections, j1"]);
    await review(app, cookie);
    expect(writer.calls.length).toBe(8);
    expect(allLines(state).every((l) => l.fix === null && l.suggestion === null && l.draft === null && l.state === "ticked")).toBe(true);
    expect(jobsOf(state)[0]!.lines[1]!.text).toBe(TYPO_LINE); // as read
    expect(jobsOf(state).every((j) => !j.checking)).toBe(true);
    expect(state.unchecked).toBe(true); // the screen never claims a finished check (#362)
    expect(JSON.stringify(state)).not.toMatch(/fail|error|retry/i);
    // The store knows the difference — found nothing, did not run and failed are different states.
    expect((await server.cvReviews.get(sessionId))?.outcome).toBe("failed");

    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-down@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    expect((await getCardsWhenRetrieved(app, cookie)).json().cards.length).toBeGreaterThan(0);
  });

  it("while the run is going: progress counts the jobs that landed, an unanswered job is still being checked, and the confirm waits", async () => {
    const writer = fakeWriter();
    writer.hold("j1");
    writer.hold("j2");
    const { app, cookie } = await withCv(writer);
    await until(() => writer.calls.length, (n) => n === 2, "both calls in flight");

    let state = await review(app, cookie);
    expect(state.progress).toEqual({ done: 0, total: 2, minutesLeft: 5 });
    expect(jobsOf(state).map((j) => j.checking)).toEqual([true, true]);
    expect(jobsOf(state)[0]!.lines[1]!.text).toBe(TYPO_LINE); // the lines as read, meanwhile
    const refused = await post(app, cookie, "/review/complete");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("review_running");

    writer.release("j1");
    state = await until(() => review(app, cookie), (s) => s.progress?.done === 1, "the first job landed");
    expect(state.progress).toEqual({ done: 1, total: 2, minutesLeft: 5 });
    expect(jobsOf(state).map((j) => j.checking)).toEqual([false, true]);
    expect(jobsOf(state)[0]!.lines[1]!.fix?.applied).toBe(true); // the finished job opens as it arrives
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(409);

    writer.release("j2");
    state = await reviewed(app, cookie);
    expect(jobsOf(state).map((j) => j.checking)).toEqual([false, false]);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-wait@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
  });

  it("undo restores the exact original and persists; Use fix applies it again; a line with no fix has nothing to undo", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    await reviewed(app, cookie);

    const undone = await put(app, cookie, "/review/fixes/nrg-managed-budget", { applied: false });
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toEqual({ id: "nrg-managed-budget", text: TYPO_LINE, applied: false });
    let line = jobsOf(await review(app, cookie))[0]!.lines[1]!;
    expect(line.text).toBe(TYPO_LINE);
    expect(line.fix).toEqual({ original: TYPO_LINE, corrected: FIXED_LINE, applied: false });
    expect(line.state).toBe("ticked"); // undoing a fix is not an untick

    expect((await put(app, cookie, "/review/fixes/nrg-managed-budget", { applied: true })).json().text).toBe(FIXED_LINE);
    line = jobsOf(await review(app, cookie))[0]!.lines[1]!;
    expect(line).toMatchObject({ text: FIXED_LINE, fix: { applied: true } });

    expect((await put(app, cookie, "/review/fixes/nrg-led-checkout", { applied: false })).statusCode).toBe(404);
    expect((await put(app, cookie, "/review/fixes/no-such-line", { applied: false })).statusCode).toBe(404);
    expect(jobsOf(await review(app, cookie))[0]!.lines[0]!.text).toBe("Led the checkout replatform.");
    expect(writer.calls.length).toBe(2); // none of this asked the writer anything
  });

  it("an undone fix stays undone through the confirm: the master CV prints the person's original", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    await reviewed(app, cookie);
    await put(app, cookie, "/review/fixes/nrg-managed-budget", { applied: false });
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-undone@example.com");
    await post(app, cookie, "/review/complete");
    const built = (await post(app, cookie, "/onboarding/build")).json();
    expect(built.rootCv.markdown).toContain(TYPO_LINE);
    expect(jobsOf(await review(app, cookie))[0]!.lines[1]!.fix?.applied).toBe(false);
  });

  it("a fix or judgement naming a line the model was not shown is dropped and counted; the real ones still land", async () => {
    const writer = fakeWriter({ bogus: true });
    const { app, cookie } = await withCv(writer);
    const state = await reviewed(app, cookie);
    expect(jobsOf(state)[0]!.lines[0]).toMatchObject({ text: "Led the checkout replatform.", fix: null, suggestion: null });
    expect(jobsOf(state)[0]!.lines[1]!.fix?.applied).toBe(true);
    expect(allLines(state).some((l) => l.id === "ghost")).toBe(false);
    expect(readCounters()["cvReview.fix_dropped"]).toBe(2); // one bogus fix per job
    expect(readCounters()["cvReview.judgement_dropped"]).toBe(2);
  });

  it("a run a restart left going is resumed on the first read, for its unfinished units only", async () => {
    const writer = fakeWriter();
    const { app, cookie, server, sessionId } = await withCv(writer);
    await reviewed(app, cookie);
    const spent = writer.calls.length;
    // The process died right after the run opened and the first job landed: the store says so and
    // nothing in this process is driving it any more.
    const landed = (await server.cvReviews.get(sessionId))!.units.find((u) => u.unit === "nrg")!.result!;
    await server.cvReviews.create(sessionId, new Date(NOW).toISOString(), ["nrg", "bsh"]);
    await server.cvReviews.recordResult(sessionId, "nrg", landed);

    const first = await review(app, cookie);
    expect(first.progress).toEqual({ done: 1, total: 2, minutesLeft: 5 }); // read as still going — and resumed
    const state = await reviewed(app, cookie);
    expect(writer.asked().slice(spent)).toEqual(["j2"]); // the finished job was never re-asked
    expect(jobsOf(state)[1]!.lines[1]!.suggestion?.kind).toBe("aim-without-result");
    expect((await server.cvReviews.get(sessionId))?.outcome).toBe("done");
  });

  // #363 — Fly stopped the machine with a call in flight. The attempt was started, never seen to
  // fail; the resume must not count it, and a crash loop must still run out.
  it("#363: an attempt a process stop cut mid-call is not a failure — the resume still asks the model", async () => {
    const writer = fakeWriter();
    const { app, cookie, server, sessionId } = await withCv(writer);
    await reviewed(app, cookie);
    const spent = writer.calls.length;
    // The store as the stop left it: the first job landed; the second had two attempts started
    // (the first failed, the retry was in flight) and only one failure seen.
    const landed = (await server.cvReviews.get(sessionId))!.units.find((u) => u.unit === "nrg")!.result!;
    await server.cvReviews.create(sessionId, new Date(NOW).toISOString(), ["nrg", "bsh"]);
    await server.cvReviews.recordResult(sessionId, "nrg", landed);
    await server.cvReviews.recordAttempt(sessionId, "bsh");
    await server.cvReviews.recordFailure(sessionId, "bsh", "writer down");
    await server.cvReviews.recordAttempt(sessionId, "bsh");

    expect((await review(app, cookie)).progress).toEqual({ done: 1, total: 2, minutesLeft: 5 });
    const state = await reviewed(app, cookie);
    expect(writer.asked().slice(spent)).toEqual(["j2"]); // asked once more, the finished job never
    expect(jobsOf(state)[1]!.lines[1]!.suggestion?.kind).toBe("aim-without-result");
    expect((await server.cvReviews.get(sessionId))).toMatchObject({ outcome: "done", units: [{ unit: "nrg" }, { unit: "bsh", attempts: 3, failures: 1 }] });
  });

  it("#363: paid attempts per unit stay bounded — a unit cut mid-call on every start is given up, never re-asked", async () => {
    const writer = fakeWriter();
    const { app, cookie, server, sessionId } = await withCv(writer);
    await reviewed(app, cookie);
    const spent = writer.calls.length;
    const landed = (await server.cvReviews.get(sessionId))!.units.find((u) => u.unit === "nrg")!.result!;
    await server.cvReviews.create(sessionId, new Date(NOW).toISOString(), ["nrg", "bsh"]);
    await server.cvReviews.recordResult(sessionId, "nrg", landed);
    for (let i = 0; i < 4; i += 1) await server.cvReviews.recordAttempt(sessionId, "bsh"); // twice the allowed failures, none seen

    const state = await reviewed(app, cookie); // the first read finds the run spent and closes it
    expect(writer.calls.length).toBe(spent);
    expect(jobsOf(state)[1]!.lines[1]!.suggestion).toBeNull(); // as read, and nothing says why
    expect((await server.cvReviews.get(sessionId))?.outcome).toBe("failed");
  });

  it("#363: the keep-alive holds the machine while the run is going — started with the run, stopped when it finishes, on a resume too", async () => {
    const held: string[] = [];
    const keepAlive = () => {
      held.push("start");
      return () => {
        held.push("stop");
      };
    };
    const writer = fakeWriter();
    writer.hold("j1");
    writer.hold("j2");
    const { app, cookie, server, sessionId } = await withCv(writer, MINED, { reviewRun: { retryDelayMs: 0, now: () => NOW, keepAlive } });
    await until(() => writer.calls.length, (n) => n === 2, "both calls in flight");
    expect(held).toEqual(["start"]); // one hold for the run, not one per job
    writer.release("j1");
    writer.release("j2");
    await reviewed(app, cookie);
    await until(() => held.length, (n) => n === 2, "the hold released");
    expect(held).toEqual(["start", "stop"]);

    // A run a restart left going is held again while it is resumed.
    const landed = (await server.cvReviews.get(sessionId))!.units.find((u) => u.unit === "nrg")!.result!;
    await server.cvReviews.create(sessionId, new Date(NOW).toISOString(), ["nrg", "bsh"]);
    await server.cvReviews.recordResult(sessionId, "nrg", landed);
    await review(app, cookie);
    await reviewed(app, cookie);
    await until(() => held.length, (n) => n === 4, "the resume's hold released");
    expect(held).toEqual(["start", "stop", "start", "stop"]);
  });

  it("a review confirmed over the wire before the read finished is left as confirmed: no run starts, no line moves", async () => {
    // Only the wire can confirm before the read lands (the screen waits for it); several journeys
    // do. The run must not then change lines the person has already signed off, unseen.
    const writer = fakeWriter();
    writer.hold("j1");
    writer.hold("j2");
    const jobBlocks = new InMemoryJobBlockStore();
    const eligibility = new InMemoryEligibilityStore();
    await jobBlocks.init();
    let releaseMiner!: () => void;
    const minerGate = new Promise<void>((r) => (releaseMiner = r));
    const { app } = buildServer({
      pipeline: {
        mine: async () => {
          await minerGate; // the read is still going while the person confirms
          return { doc: null, claims: MINED, roles: 2, needsGrill: 0 };
        },
      },
      jobBlocks,
      eligibility,
      reviewLlm: writer.llm,
      reviewRun: { retryDelayMs: 0, now: () => NOW },
    });
    const cookie = await anonSession(app);
    const { jobId } = (await post(app, cookie, "/cv/paste", { text: CV_TEXT })).json();
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    releaseMiner();
    await until(async () => (await get(app, cookie, `/jobs/${jobId}`)).json(), (job) => isTerminal(job.status), "the paste settled");
    await new Promise((r) => setImmediate(r));
    const state = await review(app, cookie);
    expect(state.progress).toBeNull();
    expect(writer.calls).toEqual([]);
    expect(jobsOf(state)[0]!.lines[1]!.text).toBe(TYPO_LINE); // as read, as confirmed
  });

  it("a session with no CV has no run and no progress", async () => {
    const writer = fakeWriter();
    const { app } = buildServer({ reviewLlm: writer.llm });
    const cookie = await anonSession(app);
    const state = await review(app, cookie);
    expect(state.progress).toBeNull();
    expect(state.unchecked).toBe(true); // no run is no check (#362)
    expect(writer.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// #342 — drafted lines.
// ---------------------------------------------------------------------------------------------
const VALID_AD_ID = liveIdFor("2026-07-05_endava-vietnam_senior-project-manager");
const MUST_HAVES = ["end-to-end-delivery", "stakeholder-coordination", "risk-dependency-control", "delivery-communication"];
const MEANINGS = [
  "Have you owned delivery from planning through completion?",
  "Which business and technical groups did you coordinate?",
  "Have you acted on delivery risks, dependencies, timelines, or budgets?",
  "How did you report progress or translate delivery detail for stakeholders?",
];
/** The fake's must-have line, as the paper shows it: the [vague phrase] brackets are not on the paper. */
const DRAFT_TEXT = (id: string) => `Owned ${id.replace(/-/g, " ")} for the business and technical groups.`;
const FIRST_DRAFT = "draft-nrg-1";
const drafts = (job: { lines: ReviewLine[] }) => job.lines.filter((l) => l.draft !== null);
const tick = (app: App, cookie: string, id: string) => post(app, cookie, `/review/drafts/${id}/tick`);

/** A fake drafting model that prints EVERY claim it is handed, one bullet each — so an unticked
 *  draft reaching it would reach the page (tickedLines.test.ts's echoingLlm). */
function echoingLlm(prompts: string[]): LlmClient {
  return {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = (prompt.split("Claims:\n")[1] ?? "").split("\n\n")[0]!;
      const bullets = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[[^\]]*\] (.+)$/gm)].map((m) => ({ text: m[2]!, claimIds: [m[1]!], outcome: "" }));
      return JSON.stringify({
        name: "Jane Doe",
        headline: "IT Project Manager",
        contact: "Paris",
        summary: "Delivery-accountable project manager.",
        experience: [{ role: "IT Project Manager", employer: "Nordic Retail Group", location: "", dates: "2021 - now", bullets, unprinted: [] }],
        skills: [{ label: "Delivery", items: ["Jira"] }],
        certifications: [],
        education: [],
        additional: [],
      });
    },
  };
}

async function tailorDraft(app: App, cookie: string) {
  const started = await post(app, cookie, "/onboarding/tailor/draft");
  if (started.statusCode === 202) await until(async () => (await get(app, cookie, `/jobs/${started.json().jobId}`)).json(), (job) => isTerminal(job.status), "the draft settled");
  return (await get(app, cookie, "/onboarding/tailor/draft")).json() as { html: string; draftedAt: string };
}

// #343: the word choices on a drafted line's vague phrase. The fake lists the typical option
// first, so the CV-first order on the wire is the resolver's, not the fake's.
const VAGUE_CHOICES = {
  phrase: "the business and technical groups",
  options: [
    { text: "the vendor teams", from: "CV", quote: "Led the checkout replatform." },
    { text: "the steering committee", from: "TYPICAL", quote: null },
  ],
};

describe("#343 word choices", () => {
  it("arrive with the stored review, CV first; a pick or the person's own words replace the phrase and print once ticked; none of it asks the writer", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    const state = await reviewed(app, cookie);
    const spent = writer.calls.length;
    const [first, second] = drafts(jobsOf(state)[0]!);
    expect(first!.draft!.vague).toEqual([VAGUE_CHOICES]);

    // The screen replaces the phrase and saves the line through the draft's own edit door.
    const picked = first!.text.replace(VAGUE_CHOICES.phrase, "the vendor teams");
    expect((await put(app, cookie, `/review/drafts/${first!.id}`, { text: picked })).json()).toEqual({ id: first!.id, text: picked });
    const typed = second!.text.replace(VAGUE_CHOICES.phrase, "the finance and warehouse teams");
    await put(app, cookie, `/review/drafts/${second!.id}`, { text: typed });
    // A reload reads the person's wording; the choices stay on the draft.
    const reloaded = drafts(jobsOf(await review(app, cookie))[0]!);
    expect(reloaded.slice(0, 2).map((l) => l.text)).toEqual([picked, typed]);
    expect(reloaded[0]!.draft!.vague).toEqual([VAGUE_CHOICES]);

    await tick(app, cookie, first!.id);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-word-choice@example.com");
    await post(app, cookie, "/review/complete");
    const printed = (await post(app, cookie, "/onboarding/build")).json().rootCv.markdown as string;
    expect(printed).toContain(picked);
    expect(printed).not.toContain(typed); // typed, but never ticked
    expect(writer.calls.length).toBe(spent);
  });
});

describe("#342 drafted lines", () => {
  it("arrive unticked at the end of their job, each with its source and flags; a job in no family gets none; nothing asked the writer twice", async () => {
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer);
    const state = await reviewed(app, cookie);
    const [nrg, bsh] = jobsOf(state);

    expect(nrg).toMatchObject({ family: "IT Project Manager", complete: false });
    expect(nrg!.lines.slice(0, 2).map((l) => l.draft)).toEqual([null, null]); // the lines as read come first
    const drafted = drafts(nrg!);
    expect(drafted.map((l) => l.id)).toEqual(["draft-nrg-1", "draft-nrg-2", "draft-nrg-3", "draft-nrg-4", "draft-nrg-5", "draft-nrg-6"]);
    expect(drafted.every((l) => l.state === "drafted" && l.fix === null && l.suggestion === null)).toBe(true);
    // One line per missing must-have, citing the must-have in the family's own words.
    expect(drafted.slice(0, 4).map((l) => l.text)).toEqual(MUST_HAVES.map(DRAFT_TEXT));
    expect(drafted.slice(0, 4).map((l) => l.draft)).toEqual(MEANINGS.map((mustHave) => ({ mustHave, quote: null, flags: [], vague: [VAGUE_CHOICES] })));
    // The extras: a fact from another job only as OPTIONAL with its quote; an industry guess flagged.
    expect(drafted[4]).toMatchObject({
      text: "Also coordinated releases for 4 agile squads.",
      draft: { mustHave: null, quote: "Coordinated releases for 4 agile squads.", flags: ["OPTIONAL"], vague: [] },
    });
    expect(drafted[5]).toMatchObject({ draft: { mustHave: null, quote: "Led the checkout replatform.", flags: ["INDUSTRY GUESS"] } });
    // A job in no published family: no drafts, no family, no stamp — and nothing says why.
    expect(bsh).toMatchObject({ family: null, complete: false });
    expect(drafts(bsh!)).toEqual([]);
    expect(writer.calls).toHaveLength(2);
  });

  it("an unticked draft never reaches the master CV, a tailored draft or an export; ticked, it reaches all three; unticked again, it stops", async () => {
    const prompts: string[] = [];
    const printed: string[] = [];
    const sent: string[] = [];
    const documentMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const mailer: Mailer = { live: false, async sendLoginLink() {}, async sendFamilyReady() {}, async sendTailoredCv(email) { sent.push(email); } };
    const writer = fakeWriter();
    const { app, cookie, server, sessionId } = await withCv(writer, MINED, { tailorLlm: echoingLlm(prompts), documentMaker, mailer });
    await reviewed(app, cookie);
    const text = DRAFT_TEXT("end-to-end-delivery");

    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-draft-gate@example.com");
    expect((await post(app, cookie, "/review/complete")).statusCode).toBe(200);
    // Completing confirmed the lines as read and left the draft a draft: pending, unticked.
    expect((await server.claims.list(sessionId)).find((c) => c.id === FIRST_DRAFT)).toMatchObject({ decision: "pending", origin: "drafted", lineState: "drafted" });
    expect(drafts(jobsOf(await review(app, cookie))[0]!).every((l) => l.state === "drafted")).toBe(true);

    // The master CV.
    const built = (await post(app, cookie, "/onboarding/build")).json();
    expect(built.rootCv.markdown).toContain("Led the checkout replatform.");
    expect(built.rootCv.markdown).not.toContain(text);
    expect(built.rootCv.markdown).not.toContain("Also coordinated releases");
    // The tailored draft: not the model's input, not the page.
    await warmRetrieval(app, cookie);
    expect((await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`)).statusCode).toBe(200);
    const before = await tailorDraft(app, cookie);
    expect(before.html).toContain("Led the checkout replatform.");
    expect(before.html).not.toContain(text);
    expect(prompts[0]).not.toContain(text);
    // The export.
    const exported = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: before.draftedAt });
    expect(exported.statusCode).toBe(202);
    await until(async () => (await get(app, cookie, `/jobs/${exported.json().jobId}`)).json(), (job) => isTerminal(job.status), "the export settled");
    expect(printed).toHaveLength(1);
    expect(printed[0]).not.toContain(text);
    expect(sent).toEqual(["review-draft-gate@example.com"]);

    // Ticked: a confirmed, user-resolved fact, reused on every CV where it helps.
    expect((await tick(app, cookie, FIRST_DRAFT)).json()).toEqual({ id: FIRST_DRAFT, text, state: "ticked" });
    expect((await post(app, cookie, "/onboarding/build")).json().rootCv.markdown).toContain(text);
    await warmRetrieval(app, cookie); // the fact set changed; the deck's search catches up
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(404); // the old draft is no draft for the new facts
    const after = await tailorDraft(app, cookie);
    expect(after.html).toContain(text);
    expect(prompts[1]).toContain(text);
    const reexported = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: after.draftedAt });
    await until(async () => (await get(app, cookie, `/jobs/${reexported.json().jobId}`)).json(), (job) => isTerminal(job.status), "the second export settled");
    expect(printed[1]).toContain(text);

    // Unticked again: it stops printing, everywhere.
    expect((await put(app, cookie, `/cv/lines/${FIRST_DRAFT}`, { state: "kept" })).statusCode).toBe(200);
    expect((await post(app, cookie, "/onboarding/build")).json().rootCv.markdown).not.toContain(text);
    await warmRetrieval(app, cookie);
    expect((await tailorDraft(app, cookie)).html).not.toContain(text);
    expect(jobsOf(await review(app, cookie))[0]!.lines.find((l) => l.id === FIRST_DRAFT)).toMatchObject({ state: "kept", draft: { flags: [] } });
    expect(writer.calls).toHaveLength(2); // none of this asked the review writer anything
  });

  it("the edit before the tick stores the person's wording; the tick makes it a confirmed, drafted-then-accepted fact; the wrong doors refuse", async () => {
    const writer = fakeWriter();
    const { app, cookie, server, sessionId } = await withCv(writer);
    await reviewed(app, cookie);
    const mine = "Owned delivery of the checkout replatform from planning to go-live.";

    const edited = await put(app, cookie, `/review/drafts/${FIRST_DRAFT}`, { text: `  ${mine}  ` });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toEqual({ id: FIRST_DRAFT, text: mine });
    let line = jobsOf(await review(app, cookie))[0]!.lines.find((l) => l.id === FIRST_DRAFT)!;
    expect(line).toMatchObject({ text: mine, state: "drafted", draft: { mustHave: MEANINGS[0] } }); // the source stays; still a draft
    expect((await server.claims.list(sessionId)).find((c) => c.id === FIRST_DRAFT)).toMatchObject({ decision: "pending", origin: "drafted" });

    expect((await tick(app, cookie, FIRST_DRAFT)).json()).toEqual({ id: FIRST_DRAFT, text: mine, state: "ticked" });
    expect((await server.claims.list(sessionId)).find((c) => c.id === FIRST_DRAFT)).toMatchObject({ text: mine, decision: "confirmed", origin: "drafted-accepted", lineState: "ticked" });
    line = jobsOf(await review(app, cookie))[0]!.lines.find((l) => l.id === FIRST_DRAFT)!;
    expect(line).toMatchObject({ text: mine, state: "ticked", draft: { mustHave: MEANINGS[0], quote: null, flags: [] } });
    // It prints, in the person's own words, with no confirm needed.
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await signIn(app, cookie, "review-draft-edit@example.com");
    await post(app, cookie, "/review/complete");
    expect((await post(app, cookie, "/onboarding/build")).json().rootCv.markdown).toContain(mine);
    // The profile shows the ticked draft as the person's own fact, and not the unticked ones.
    const profile = (await get(app, cookie, "/profile")).json() as { domains: Array<{ facts: Array<{ id: string; source: string }> }> };
    const facts = profile.domains.flatMap((d) => d.facts);
    expect(facts.find((f) => f.id === FIRST_DRAFT)).toMatchObject({ source: "told" });
    expect(facts.some((f) => f.id === "draft-nrg-2")).toBe(false);

    // The wrong doors: a ticked draft is not edited here; a line read from the CV is not a draft;
    // the line door cannot tick a draft; ticking twice is nothing.
    expect((await put(app, cookie, `/review/drafts/${FIRST_DRAFT}`, { text: "again" })).statusCode).toBe(404);
    expect((await put(app, cookie, "/review/drafts/nrg-led-checkout", { text: "mine" })).statusCode).toBe(404);
    expect((await tick(app, cookie, "nrg-led-checkout")).statusCode).toBe(404);
    expect((await tick(app, cookie, FIRST_DRAFT)).statusCode).toBe(404);
    expect((await put(app, cookie, "/cv/lines/draft-nrg-2", { state: "ticked" })).statusCode).toBe(404);
    expect((await put(app, cookie, `/review/drafts/draft-nrg-2`, { text: "   " })).statusCode).toBe(400);
    expect(jobsOf(await review(app, cookie))[0]!.lines.find((l) => l.id === "draft-nrg-2")).toMatchObject({ state: "drafted", text: DRAFT_TEXT("stakeholder-coordination") });
    expect(jobsOf(await review(app, cookie))[0]!.lines.find((l) => l.id === "nrg-led-checkout")!.text).toBe("Led the checkout replatform.");
  });

  it("a job whose lines show every must-have reads complete and gets no draft", async () => {
    const shown = [
      claim({ id: "nrg-1", role: NRG, text: "Owned end to end delivery of the checkout replatform." }),
      claim({ id: "nrg-2", role: NRG, text: "Ran stakeholder coordination across business and IT." }),
      claim({ id: "nrg-3", role: NRG, text: "Kept risk dependency control on three vendors." }),
      claim({ id: "nrg-4", role: NRG, text: "Handled delivery communication to the steering committee." }),
      claim({ id: "bsh-1", role: BSH, text: "Coordinated releases for 4 agile squads." }),
    ];
    const writer = fakeWriter();
    const { app, cookie } = await withCv(writer, shown);
    const [nrg, bsh] = jobsOf(await reviewed(app, cookie));
    expect(nrg).toMatchObject({ family: "IT Project Manager", complete: true });
    expect(drafts(nrg!)).toEqual([]);
    expect(nrg!.lines).toHaveLength(4);
    expect(bsh).toMatchObject({ family: null, complete: false });
  });

  it("a reload shows the same wording and never re-calls the writer; a draft with no source, one citing a must-have the family lacks, or one for a job in no family, is dropped and counted — and a dropped draft never stamps a job complete", async () => {
    const writer = fakeWriter({ badDrafts: true });
    const { app, cookie } = await withCv(writer);
    const first = await reviewed(app, cookie);
    const again = await review(app, cookie);
    expect(drafts(jobsOf(again)[0]!)).toEqual(drafts(jobsOf(first)[0]!));
    expect(drafts(jobsOf(again)[0]!).map((l) => l.id)).toEqual(["draft-nrg-1", "draft-nrg-2", "draft-nrg-3", "draft-nrg-5", "draft-nrg-6"]); // the 4th was dropped
    expect(writer.calls).toHaveLength(2);
    // The unsourced line on the placed job, the one citing a must-have the family does not have, and
    // the line for the job placed in none: none landed.
    expect(allLines(again).some((l) => l.text === "A line with no source at all." || l.text === DRAFT_TEXT("delivery-communication"))).toBe(false);
    expect(drafts(jobsOf(again)[1]!)).toEqual([]);
    expect(readCounters()["cvReview.draft_dropped"]).toBe(3);
    // The must-have whose draft was dropped is still missing by the model's own account: no stamp.
    expect(jobsOf(again)[0]).toMatchObject({ family: "IT Project Manager", complete: false });
  });
});

// ---------------------------------------------------------------------------------------------
// #363 — the keep-alive over HTTP: a request held open through Fly's proxy is the one thing that
// reads as load to its auto-stop (a request every few seconds does not — see lessons.md).
// ---------------------------------------------------------------------------------------------
describe("#363 the keep-alive over HTTP", () => {
  const OPS_KEY = "test-ops-key-363";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let previousOpsKey: string | undefined;
  beforeEach(() => {
    previousOpsKey = process.env.OPS_KEY;
    process.env.OPS_KEY = OPS_KEY;
  });
  afterEach(() => {
    if (previousOpsKey === undefined) delete process.env.OPS_KEY;
    else process.env.OPS_KEY = previousOpsKey;
  });

  it("the ops route holds the request for the asked time behind OPS_KEY, and refuses at once without it", async () => {
    const { app } = buildServer();
    const t0 = Date.now();
    const held = await app.inject({ method: "GET", url: "/ops/keep-alive?ms=60", headers: { "x-ops-key": OPS_KEY } });
    expect(held.statusCode).toBe(204);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55); // a timer may fire a few ms early
    expect(readCounters()["cvReview.keep_alive_held"]).toBe(1);
    const t1 = Date.now();
    expect((await app.inject({ method: "GET", url: "/ops/keep-alive?ms=60" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/ops/keep-alive?ms=60", headers: { "x-ops-key": "wrong" } })).statusCode).toBe(403);
    expect(Date.now() - t1).toBeLessThan(55);
    expect(readCounters()["cvReview.keep_alive_held"]).toBe(1);
  });

  it("keepAliveOverHttp keeps one held request in flight back to back until stopped", async () => {
    const { app } = buildServer();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const stop = keepAliveOverHttp(`${address}/ops/keep-alive`, OPS_KEY, 20)();
      // A real socket to a real listener: this one waits on the clock (`until`'s setImmediate loop
      // spins out in milliseconds), and gives up loudly like `until` does.
      for (let i = 0; (readCounters()["cvReview.keep_alive_held"] ?? 0) < 3; i += 1) {
        if (i === 100) throw new Error("never happened: three holds back to back");
        await sleep(10);
      }
      stop();
      const seen = readCounters()["cvReview.keep_alive_held"];
      await sleep(100);
      expect(readCounters()["cvReview.keep_alive_held"]).toBe(seen); // nothing starts after the stop
    } finally {
      await app.close();
    }
  });
});

describe("#341 the answer, as the product model wrote it", () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

  it("parses the whole-CV run and the thin-job run of Fable 5.1 max (#340's scored runs)", () => {
    const whole = parseReviewAnswer(fixture("cv-review-fable-5-1-run1.json"));
    expect(whole.jobs.map((j) => j.job)).toEqual(["bred", "okoone", "socgen"]);
    expect(whole.sections?.map((s) => s.section)).toEqual(["summary", "projects", "skills", "education", "additional"]);
    const untick = whole.jobs[0]!.judgements.find((j) => j.verdict === "untick");
    expect(untick).toMatchObject({ line: "b15", kind: "aim-without-result" });
    expect(whole.jobs[1]).toMatchObject({ family: null, mustHaves: [], drafted: [] }); // the Product Owner job: no published family
    expect(whole.refused).toHaveLength(4);

    const thin = parseReviewAnswer(fixture("cv-review-fable-5-1-thin-run1.json"));
    expect(thin.jobs[0]!.drafted.length).toBe(8);
    expect(thin.jobs[0]!.drafted[0]!.vague[0]!.options[0]).toMatchObject({ from: "CV" });
  });

  it("tolerates a code fence and refuses anything that is not the one JSON object", () => {
    expect(parseReviewAnswer("```json\n" + fixture("cv-review-fable-5-1-run1.json") + "\n```").jobs).toHaveLength(3);
    expect(() => parseReviewAnswer("Here is my review: {}")).toThrow();
    expect(() => parseReviewAnswer(JSON.stringify({ jobs: [] }))).toThrow(); // letterhead/sections/refused missing
  });
});
