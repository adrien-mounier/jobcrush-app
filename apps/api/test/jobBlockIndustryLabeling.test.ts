// #281 (the seventh fact) — every dated job carries a correctable INDUSTRY.
//
// Tested at the two seams the spec names: the MODEL CLIENT seam (a fake LLM injected where
// production injects the real one, asserting what a given answer becomes) and the JOB-RECORD STORE
// seam (read back through GET /job-blocks, the route the work-history screen actually calls). No new
// injection points: a test that wants a particular placement makes the FAKE MODEL say it.
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryJobStore } from "../src/jobs.js";
import { InMemoryClaimStore } from "../src/claims.js";
import { runOnboardingJob } from "../src/pipeline.js";
import { makeJobBlockIndustryLabeler, placeJobIndustry } from "../src/industryLabeler.js";
import { publishedIndustryVocabulary } from "../src/industryVocabulary.js";
import type { LlmClient } from "../src/llm.js";
import type { CandidateClaim, JobBlockView, MinedJobBlock } from "@jobcrush/contracts";
import { readCounters, resetCountersForTest } from "../src/counters.js";
import { InMemoryUnmappedLabelStore } from "../src/unmappedLabels.js";

const INDUSTRIES = publishedIndustryVocabulary().activeIndustries();
const BANKING = INDUSTRIES.find((i) => i.industryId === "banking")!;
const CONSULTING = INDUSTRIES.find((i) => i.industryId === "consulting")!;

/** Answers by employer, and counts every call — the checkpoint tests assert on that count, which is
 *  the only thing "a retry re-spends nothing" can mean from outside. */
function fakeLlm(answerFor: (employer: string, prompt: string) => string) {
  const employers: string[] = [];
  const prompts: string[] = [];
  const llm: LlmClient = {
    async complete(prompt: string) {
      const employer = (/^Employer: (.*)$/m.exec(prompt) ?? [, ""])[1]!.trim();
      employers.push(employer);
      prompts.push(prompt);
      return answerFor(employer, prompt);
    },
  };
  return { llm, employers, prompts };
}

const placedAnswer = (ids: string[], confidence = "certain") =>
  JSON.stringify({ why: "because", outcome: "confirmed", industryIds: ids, confidence });
const PLACED = placedAnswer([BANKING.industryId]);
const UNMAPPED_ANSWER = JSON.stringify({ why: "nothing fits", outcome: "unmapped" });

function minedBlock(
  id: string,
  title: string,
  employer: string,
  kind: MinedJobBlock["kind"]["value"] = "job",
): MinedJobBlock {
  const q = { source_quote: title, machine_touch: "verbatim" as const, classification: "Verified" as const };
  return {
    id,
    employer: { value: employer, ...q },
    title: { value: title, ...q },
    start: { value: { year: 2019, month: 1, precision: "month" }, ...q },
    end: { value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } }, ...q },
    kind: { value: kind, ...q },
  };
}

const MINED = [
  minedBlock("nordea-analyst", "Settlements Analyst", "Nordea Bank"),
  minedBlock("acme-consultant", "Consultant", "Acme Advisory"),
  minedBlock("uni-degree", "MSc Economics", "Aarhus University", "education"),
];

function claim(id: string, role: string, text: string): CandidateClaim {
  return {
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    role,
    text,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: text.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
  };
}

/** A server plus one session, with the pipeline's job-block steps wired to the fakes below. */
async function stack(options: {
  answerFor: (employer: string, prompt: string) => string;
  blocks?: MinedJobBlock[];
  claims?: CandidateClaim[];
  labeler?: (sessionId: string) => Promise<void>;
  routeRetries?: boolean;
}) {
  const jobBlocks = new InMemoryJobBlockStore();
  await jobBlocks.init();
  const claims = new InMemoryClaimStore();
  await claims.init();
  const { llm, employers, prompts } = fakeLlm(options.answerFor);
  const unmappedLabels = new InMemoryUnmappedLabelStore();
  const labelJobBlockIndustries =
    options.labeler ?? makeJobBlockIndustryLabeler(llm, INDUSTRIES, jobBlocks, claims, unmappedLabels);
  const server = buildServer({
    jobBlocks,
    claims,
    pipeline: options.routeRetries ? { labelJobBlockIndustries } : undefined,
  });
  const res = await server.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  const sessionId = (
    await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })
  ).json().id as string;

  if (options.claims?.length) await claims.seed(sessionId, options.claims);

  const jobs = new InMemoryJobStore();
  const mine = async (blocks: MinedJobBlock[] = options.blocks ?? MINED) => {
    const job = await jobs.create("onboarding", sessionId);
    await runOnboardingJob(jobs, job.id, { type: "paste", text: "a cv" }, {
      mineJobBlocks: async () => ({ doc: { schemaVersion: "1", blocks, parser_flags: [] }, rawOutput: "raw" }),
      persistJobBlocks: async (sid, doc, raw) => jobBlocks.ingest(sid, doc, raw),
      labelJobBlockIndustries,
    });
    return job.id;
  };

  const read = async (): Promise<{ blocks: JobBlockView[] }> =>
    (await server.app.inject({ method: "GET", url: "/job-blocks", headers: { cookie } })).json();

  const correct = (blockId: string, body: unknown) =>
    server.app.inject({ method: "POST", url: `/job-blocks/${blockId}/correct`, headers: { cookie }, payload: body });

  return { server, cookie, sessionId, jobBlocks, claims, employers, prompts, mine, read, correct, unmappedLabels };
}

const industryOf = (blocks: JobBlockView[], id: string) => blocks.find((b) => b.id === id)!.industry;

beforeEach(() => resetCountersForTest());

describe("AC3 — after a CV upload every dated JOB carries an industry placement, and nothing else does", () => {
  it("places each mined job with the industry's own id and version, and never calls for a degree", async () => {
    const s = await stack({ answerFor: (employer) => (employer === "Nordea Bank" ? PLACED : UNMAPPED_ANSWER) });
    await s.mine();
    const { blocks } = await s.read();

    expect(industryOf(blocks, "nordea-analyst").value).toEqual({
      schemaVersion: "1",
      outcome: "confirmed",
      industries: [{ industryId: "banking", version: BANKING.version }],
      confidence: "certain",
    });
    expect(industryOf(blocks, "nordea-analyst").origin).toEqual({ kind: "worked_out" });
    // The honest unplaced answer, stored as such rather than left looking un-run.
    expect(industryOf(blocks, "acme-consultant").value).toEqual({ schemaVersion: "1", outcome: "unmapped" });

    // A degree belongs to no employer industry: never labeled, and never paid for.
    expect(industryOf(blocks, "uni-degree").value).toBeNull();
    expect(s.employers).toEqual(["Nordea Bank", "Acme Advisory"]);
  });

  it("carries TWO industries when the work was served into another — the ordinary plural case", async () => {
    const s = await stack({
      blocks: [minedBlock("acme-consultant", "Consultant", "Acme Advisory")],
      answerFor: () => placedAnswer([CONSULTING.industryId, BANKING.industryId], "likely"),
    });
    await s.mine();
    const { blocks } = await s.read();

    const placement = industryOf(blocks, "acme-consultant").value;
    expect(placement).toMatchObject({
      outcome: "confirmed",
      industries: [
        { industryId: "consulting", version: CONSULTING.version },
        { industryId: "banking", version: BANKING.version },
      ],
      confidence: "likely",
    });
    expect(readCounters()["industryLabeler.multi_industry"]).toBe(1);
  });

  it("sends her own CV lines for that job as evidence, and nobody else's", async () => {
    const s = await stack({
      blocks: [minedBlock("acme-consultant", "Consultant", "Acme Advisory")],
      claims: [
        claim("c1", "Acme Advisory — Consultant", "Reconciled trade settlements for two retail banks."),
        claim("c2", "Nordic Bakery — Baker", "Proofed and shaped sourdough overnight."),
      ],
      answerFor: () => PLACED,
    });
    await s.mine();

    expect(s.prompts[0]).toContain("Reconciled trade settlements");
    expect(s.prompts[0]).not.toContain("sourdough");
  });
});

describe("AC5 — a correction supersedes the machine, and no re-run overwrites it", () => {
  it("stores her pick as certain, keeps what it superseded, and skips the job on the next run", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    await s.mine();
    expect(s.employers).toHaveLength(2);

    const res = await s.correct("nordea-analyst", {
      key: "industry",
      value: { industryId: BANKING.industryId, version: BANKING.version },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().downstream).toBe("We'll show this job as Banking from now on.");

    const corrected = industryOf((await s.read()).blocks, "nordea-analyst");
    expect(corrected.value).toEqual({
      schemaVersion: "1",
      outcome: "confirmed",
      industries: [{ industryId: "banking", version: BANKING.version }],
      confidence: "certain",
    });
    // Superseded, never erased: the machine's own answer is still readable behind hers.
    expect(corrected.origin).toEqual({
      kind: "corrected",
      supersededValue: { schemaVersion: "1", outcome: "unmapped" },
    });

    // A second upload re-runs the labeler. The corrected job is skipped like any other answered
    // one, so nothing can overwrite her.
    await s.mine([minedBlock("second-job", "Baker", "Nordic Bakery")]);
    expect(s.employers).toEqual(["Nordea Bank", "Acme Advisory", "Nordic Bakery"]);
    expect(industryOf((await s.read()).blocks, "nordea-analyst").value).toMatchObject({
      outcome: "confirmed",
      industries: [{ industryId: "banking", version: BANKING.version }],
    });
  });

  it("refuses an industry that is not published — the vocabulary is closed outside the screen", async () => {
    const s = await stack({ answerFor: () => PLACED });
    await s.mine();
    const res = await s.correct("nordea-analyst", {
      key: "industry",
      value: { industryId: "crypto-mining", version: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("unknown_industry");
  });
});

describe("an unmapped we manufactured is never stored — only one the model actually gave", () => {
  // Found by the #281 spec review. Storing the no-vocabulary answer would write `unmapped` onto
  // every job permanently: AC6's checkpoint would then skip them forever, and they would still be
  // unplaced the day the vocabulary loaded correctly.
  it("leaves every job unlabeled when no vocabulary is published, and places them once it is", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    await jobBlocks.init();
    const { llm, employers } = fakeLlm(() => PLACED);
    await jobBlocks.ingest(
      "s",
      { schemaVersion: "1", blocks: [minedBlock("nordea-analyst", "Settlements Analyst", "Nordea Bank")] },
      "raw",
    );

    await makeJobBlockIndustryLabeler(llm, [], jobBlocks)("s");
    expect(employers).toEqual([]); // nothing to place into, so nothing paid for
    expect((await jobBlocks.list("s"))[0]!.industry.value).toBeNull();

    // The vocabulary arrives. The job is placed for real, because nothing was written over it.
    await makeJobBlockIndustryLabeler(llm, INDUSTRIES, jobBlocks)("s");
    expect((await jobBlocks.list("s"))[0]!.industry.value).toMatchObject({ outcome: "confirmed" });
  });

  it("leaves a job with no employer, no title and no lines unlabeled rather than stamping it", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    await jobBlocks.init();
    const { llm, employers } = fakeLlm(() => PLACED);
    const blank = minedBlock("blank", "x", "y");
    blank.employer.value = " ";
    blank.title.value = " ";
    await jobBlocks.ingest("s", { schemaVersion: "1", blocks: [blank] }, "raw");

    await makeJobBlockIndustryLabeler(llm, INDUSTRIES, jobBlocks)("s");
    expect(employers).toEqual([]);
    expect((await jobBlocks.list("s"))[0]!.industry.value).toBeNull();
  });
});

describe("the undo of an industry correction actually undoes it", () => {
  // #157 Design A — "no action in this flow is irreversible without a visible undo." A job the
  // machine never placed has no earlier reference to revert to, so the door takes an explicit
  // unmapped: what she reads back is what she saw before she touched it.
  it("puts a corrected job back to 'we couldn't work this out'", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    await s.mine();
    await s.correct("nordea-analyst", {
      key: "industry",
      value: { industryId: BANKING.industryId, version: BANKING.version },
    });

    const undone = await s.correct("nordea-analyst", {
      key: "industry",
      value: { schemaVersion: "1", outcome: "unmapped" },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().downstream).toBe("We've put this job's industry back to not knowing.");
    expect(industryOf((await s.read()).blocks, "nordea-analyst").value).toEqual({
      schemaVersion: "1",
      outcome: "unmapped",
    });
  });

  it("puts a TWO-industry machine placement back whole, at the confidence it carried", async () => {
    // Found by the #281 QA gate. Restoring only the first of two, at a confidence nobody measured,
    // is an undo that quietly changes the answer — and #285 reads that confidence.
    const s = await stack({
      blocks: [minedBlock("acme-consultant", "Consultant", "Acme Advisory")],
      answerFor: () => placedAnswer([CONSULTING.industryId, BANKING.industryId], "likely"),
    });
    await s.mine();
    const machine = industryOf((await s.read()).blocks, "acme-consultant").value;

    await s.correct("acme-consultant", {
      key: "industry",
      value: { industryId: BANKING.industryId, version: BANKING.version },
    });
    const undone = await s.correct("acme-consultant", { key: "industry", value: machine });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().downstream).toBe("We'll show this job as Consulting and Banking from now on.");
    expect(industryOf((await s.read()).blocks, "acme-consultant").value).toEqual(machine);
  });

  it("refuses an undo naming an industry that is no longer published", async () => {
    // An undo is still a write, so it goes through the same closed-vocabulary guard.
    const s = await stack({ answerFor: () => PLACED });
    await s.mine();
    const res = await s.correct("nordea-analyst", {
      key: "industry",
      value: {
        schemaVersion: "1",
        outcome: "confirmed",
        industries: [{ industryId: "whaling", version: 1 }],
        confidence: "certain",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("unknown_industry");
  });

  it("still refuses anything that is neither a published industry nor the undo", async () => {
    const s = await stack({ answerFor: () => PLACED });
    await s.mine();
    for (const value of [{ outcome: "confirmed" }, { industryId: "banking" }, "banking", { schemaVersion: "2", outcome: "unmapped" }]) {
      const res = await s.correct("nordea-analyst", { key: "industry", value });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("AC6 — a job whose placement has landed is skipped, at per-job granularity", () => {
  it("re-executes no completed call on a pipeline retry", async () => {
    const s = await stack({ answerFor: () => PLACED });
    await s.mine();
    expect(s.employers).toEqual(["Nordea Bank", "Acme Advisory"]);

    await s.mine(); // same blocks again — every one of them already answered
    expect(s.employers).toEqual(["Nordea Bank", "Acme Advisory"]);
  });
});

describe("AC7 — one bad answer is re-prompted, a second degrades to unmapped, and is never stored", () => {
  it("re-prompts once with the validation error and keeps the corrected answer", async () => {
    let calls = 0;
    const { llm } = fakeLlm(() => (calls++ === 0 ? '{"outcome":"confirmed","industryIds":["nope"]}' : PLACED));
    const result = await placeJobIndustry(
      { employer: "Nordea Bank", title: "Settlements Analyst", lines: [] },
      INDUSTRIES,
      llm,
    );
    expect(calls).toBe(2);
    expect(result.degraded).toBe(false);
    expect(result.placement).toMatchObject({ outcome: "confirmed" });
  });

  it("degrades to unmapped after a second bad answer, and the step leaves the job unlabeled", async () => {
    const s = await stack({
      blocks: [minedBlock("nordea-analyst", "Settlements Analyst", "Nordea Bank")],
      answerFor: () => "not json at all",
    });
    await s.mine();

    // Two attempts, both refused. Nothing is stored, so the job reads as never-run and is placed
    // for real on the next pass rather than carrying an answer the model never gave.
    expect(s.employers).toEqual(["Nordea Bank", "Nordea Bank"]);
    expect(industryOf((await s.read()).blocks, "nordea-analyst").value).toBeNull();
    expect(readCounters()["industryLabeler.output_invalid"]).toBe(1);
    expect(readCounters()["industryLabeler.unmapped"]).toBe(1);
  });
});

describe("AC8 — one failed job never fails the run", () => {
  it("records the failure, steps over it, and still places the next job", async () => {
    const s = await stack({
      answerFor: (employer) => {
        if (employer === "Nordea Bank") throw new Error("provider exploded");
        return PLACED;
      },
    });
    await s.mine();
    const { blocks } = await s.read();

    expect(industryOf(blocks, "nordea-analyst").value).toBeNull();
    expect(industryOf(blocks, "acme-consultant").value).toMatchObject({ outcome: "confirmed" });
    expect(readCounters()["industryLabeler.call_failed"]).toBe(1);
  });
});

describe("AC9 — every honest unmapped reaches the durable growth feed, told apart from a fault", () => {
  it("records the employer with its own source and session, and a reason that says which it was", async () => {
    const s = await stack({
      blocks: [
        minedBlock("acme-consultant", "Consultant", "Acme Advisory"),
        minedBlock("weird-co", "Analyst", "Zzzz Holdings"),
      ],
      answerFor: (employer) => (employer === "Acme Advisory" ? UNMAPPED_ANSWER : "not json at all"),
    });
    await s.mine();

    const recorded = await s.unmappedLabels.recent();
    expect(recorded.every((entry) => entry.source === "past_job_industry")).toBe(true);
    expect(recorded.every((entry) => entry.sessionId === s.sessionId)).toBe(true);

    const honest = recorded.find((entry) => entry.label.startsWith("Acme Advisory"))!;
    expect(honest.reason).toBe("labeler said no industry fits");
    const fault = recorded.find((entry) => entry.label.startsWith("Zzzz Holdings"))!;
    expect(fault.reason).toContain("output failed validation twice");
  });
});

describe("AC10 — the counters an operator watches", () => {
  it("counts placed, unmapped, multi-industry, output-invalid and call-failed apart", async () => {
    const s = await stack({
      blocks: [
        minedBlock("nordea-analyst", "Settlements Analyst", "Nordea Bank"),
        minedBlock("acme-consultant", "Consultant", "Acme Advisory"),
        minedBlock("both-co", "Programme Manager", "Delta Partners"),
      ],
      answerFor: (employer) => {
        if (employer === "Nordea Bank") return PLACED;
        if (employer === "Delta Partners") return placedAnswer([CONSULTING.industryId, BANKING.industryId]);
        return UNMAPPED_ANSWER;
      },
    });
    await s.mine();

    const counters = readCounters();
    expect(counters["industryLabeler.placed"]).toBe(2);
    expect(counters["industryLabeler.multi_industry"]).toBe(1);
    expect(counters["industryLabeler.unmapped"]).toBe(1);
    expect(counters["industryLabeler.output_invalid"]).toBe(0);
    expect(counters["industryLabeler.call_failed"]).toBe(0);
  });
});

describe("AC12 — no number a person is judged on moves", () => {
  it("leaves the years-of-experience total exactly where labeling found it", async () => {
    const s = await stack({ answerFor: () => PLACED });
    await s.mine();
    // Placement is a label, not a date: the same three blocks produce the same total before and
    // after. Read through the API rather than recomputed here, so a hidden write would show.
    const before = (await s.read()).blocks.map((b) => [b.id, b.countsTowardExperience, b.start.value, b.end.value]);
    await s.mine();
    expect((await s.read()).blocks.map((b) => [b.id, b.countsTowardExperience, b.start.value, b.end.value])).toEqual(
      before,
    );
  });
});

describe("the route's own retry places a job an earlier run missed", () => {
  it("labels on read, without a person doing anything", async () => {
    let fail = true;
    const s = await stack({
      routeRetries: true,
      blocks: [minedBlock("nordea-analyst", "Settlements Analyst", "Nordea Bank")],
      answerFor: () => {
        if (fail) throw new Error("provider exploded");
        return PLACED;
      },
    });
    await s.mine();
    expect(industryOf((await s.read()).blocks, "nordea-analyst").value).toBeNull();

    fail = false;
    expect(industryOf((await s.read()).blocks, "nordea-analyst").value).toMatchObject({ outcome: "confirmed" });
  });
});
