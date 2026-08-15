// #221 (labeler slice 2) — every past job carries a correctable family label.
//
// Tested at the API surface with the fake LLM injected at the seam production uses (the pipeline's
// `labelJobBlocks`, built by makeJobBlockLabeler exactly as main.ts builds it), and read back
// through GET /job-blocks — the route the review screen actually calls. No new injection points:
// a test that wants a particular placement makes the FAKE MODEL say it.
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryJobStore } from "../src/jobs.js";
import { runOnboardingJob } from "../src/pipeline.js";
import { makeJobBlockLabeler, publishedFamilies, type PublishedFamily } from "../src/familyLabeler.js";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import type { LlmClient } from "../src/llm.js";
import type { JobBlockView, MinedJobBlock } from "@jobcrush/contracts";
import { readCounters, recentUnmappedLabelsList, resetCountersForTest } from "../src/counters.js";
import { computeYearsWorked } from "../src/yearsWorked.js";

const PUBLISHED = publishedFamilies(initialProductionFamilyFloors());
const IT_DELIVERY = PUBLISHED[0]!;

// A second published family so the ambiguity path has two real choices to be shown (production
// publishes exactly one today — familyLabeler.test.ts makes the same fixture, for the same reason).
const TWO_FAMILIES: PublishedFamily[] = [
  IT_DELIVERY,
  {
    familyId: "product-management",
    version: 2,
    label: "Product management",
    scope: "Deciding what a product should be and why.",
    exampleTitles: ["Product Manager"],
    coreWork: ["Have you owned a product's direction?"],
  },
];

/** Answers by job title, and counts every call — the checkpoint tests assert on that count, which is
 *  the only thing "a retry re-spends nothing" can mean from outside. */
function fakeLlm(answerFor: (role: string) => string) {
  const roles: string[] = [];
  const llm: LlmClient = {
    async complete(prompt: string) {
      const role = (/## The role to place\s+(.+)/.exec(prompt) ?? [, ""])[1]!.trim();
      roles.push(role);
      return answerFor(role);
    },
  };
  return { llm, roles };
}

const confirmedAnswer = (ids: string[], confidence = "certain") =>
  JSON.stringify({ outcome: "confirmed", familyIds: ids, confidence });
const CONFIRMED = confirmedAnswer([IT_DELIVERY.familyId]);
const UNMAPPED_ANSWER = JSON.stringify({ outcome: "unmapped" });

function minedBlock(id: string, title: string, employer = "Nordic Retail"): MinedJobBlock {
  const q = { source_quote: title, machine_touch: "verbatim" as const, classification: "Verified" as const };
  return {
    id,
    employer: { value: employer, ...q },
    title: { value: title, ...q },
    start: { value: { year: 2019, month: 1, precision: "month" }, ...q },
    end: { value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } }, ...q },
    kind: { value: "job", ...q },
  };
}

const MINED = [minedBlock("nordic-pm", "IT Project Manager"), minedBlock("cafe-baker", "Pastry Chef", "Café Nord")];

/** A server plus one session, with the pipeline's job-block steps wired to the fakes below. */
async function stack(options: {
  answerFor: (role: string) => string;
  families?: PublishedFamily[];
  blocks?: MinedJobBlock[];
  labeler?: (sessionId: string) => Promise<void>;
}) {
  const jobBlocks = new InMemoryJobBlockStore();
  await jobBlocks.init();
  const { llm, roles } = fakeLlm(options.answerFor);
  const labelJobBlocks =
    options.labeler ?? makeJobBlockLabeler(llm, options.families ?? PUBLISHED, jobBlocks);
  const server = buildServer({ jobBlocks });
  const res = await server.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  const sessionId = (
    await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })
  ).json().id as string;

  const jobs = new InMemoryJobStore();
  const mine = async (blocks: MinedJobBlock[] = options.blocks ?? MINED) => {
    const job = await jobs.create("onboarding", sessionId);
    await runOnboardingJob(jobs, job.id, { type: "paste", text: "a cv" }, [], {
      mineJobBlocks: async () => ({ doc: { schemaVersion: "1", blocks, parser_flags: [] }, rawOutput: "raw" }),
      persistJobBlocks: async (sid, doc, raw) => jobBlocks.ingest(sid, doc, raw),
      labelJobBlocks,
      // No `mine` step: the claim miner is a different subsystem and would only add noise here.
    });
    return job.id;
  };

  const read = async (): Promise<{ blocks: JobBlockView[] }> =>
    (await server.app.inject({ method: "GET", url: "/job-blocks", headers: { cookie } })).json();

  return { server, cookie, sessionId, jobBlocks, jobs, roles, mine, read };
}

const familyOf = (blocks: JobBlockView[], id: string) => blocks.find((b) => b.id === id)!.family;

beforeEach(() => resetCountersForTest());

describe("#221 AC1 — every dated job record carries a family placement", () => {
  it("places each mined block, and says so with the family's own id and version", async () => {
    const s = await stack({ answerFor: (role) => (role === "IT Project Manager" ? CONFIRMED : UNMAPPED_ANSWER) });
    await s.mine();
    const { blocks } = await s.read();

    expect(familyOf(blocks, "nordic-pm").value).toEqual({
      schemaVersion: "2",
      outcome: "confirmed",
      families: [{ familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version }],
      confidence: "certain",
    });
    // Honestly unmapped rather than pushed into the nearest family (ADR-0014 decision 1).
    expect(familyOf(blocks, "cafe-baker").value).toEqual({ schemaVersion: "2", outcome: "unmapped" });
    // The label quotes no source words — it was worked out, not read (#221's own wording).
    expect(familyOf(blocks, "nordic-pm").origin).toEqual({ kind: "worked_out" });
  });

  // #231 — a job that is genuinely two kinds of work is ANSWERED with both, not handed back as a
  // question. Nobody is asked, so the placement has to be able to say "both".
  it("stores every family a job belongs to, with the confidence the labeler gave", async () => {
    const s = await stack({
      families: TWO_FAMILIES,
      answerFor: () => confirmedAnswer(TWO_FAMILIES.map((f) => f.familyId), "likely"),
    });
    await s.mine();
    const placement = familyOf((await s.read()).blocks, "nordic-pm").value;

    expect(placement).toEqual({
      schemaVersion: "2",
      outcome: "confirmed",
      families: [
        { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
        { familyId: "product-management", version: 2 },
      ],
      confidence: "likely",
    });
    // Both mined jobs got the same two-family answer, so both count.
    expect(readCounters()["familyLabeler.multi_family"]).toBe(2);
  });

  it("pays for jobs only — a degree belongs to no job family, so no call is made for one", async () => {
    const degree: MinedJobBlock = {
      ...minedBlock("warsaw-msc", "MSc Management Information Systems", "University of Warsaw"),
      kind: {
        value: "education",
        source_quote: "MSc MIS",
        machine_touch: "verbatim",
        classification: "Verified",
      },
    };
    const s = await stack({ answerFor: () => CONFIRMED, blocks: [MINED[0]!, degree] });
    await s.mine();

    expect(s.roles).toEqual(["IT Project Manager"]);
    expect(familyOf((await s.read()).blocks, "warsaw-msc").value).toBeNull();
  });

  // #231 — the published list travelled with the deck only so the screen could offer choices for an
  // unplaced job. Nobody is asked any more, so nothing reads it and it is no longer sent.
  it("no longer serves the published families with the deck — nothing asks", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    expect((await s.read() as Record<string, unknown>).families).toBeUndefined();
  });
});

describe("#221 AC2 — the labeling step is checkpointed", () => {
  it("a second pipeline run re-executes no completed labeler call", async () => {
    const s = await stack({ answerFor: () => CONFIRMED });
    await s.mine();
    expect(s.roles).toEqual(["IT Project Manager", "Pastry Chef"]);

    await s.mine(); // the same CV again — every block is an id collision, all already placed
    expect(s.roles).toHaveLength(2); // not one call more

    // …but a block that arrives NEW on the second read is placed, so the checkpoint can't be a
    // blunt "this session has been labeled once" flag.
    await s.mine([minedBlock("late-arrival", "Delivery Lead")]);
    expect(s.roles).toEqual(["IT Project Manager", "Pastry Chef", "Delivery Lead"]);
  });
});

describe("#221 AC3 — a labeler failure is recorded, not fatal", () => {
  it("leaves the block unlabeled (reads as unmapped), counts it, and lets the run finish", async () => {
    const s = await stack({
      answerFor: (role) => {
        if (role === "IT Project Manager") throw new Error("model unavailable");
        return CONFIRMED;
      },
    });
    const jobId = await s.mine();

    expect((await s.jobs.get(jobId))?.status).toBe("completed"); // the upload did NOT fail
    expect(readCounters()["familyLabeler.call_failed"]).toBe(1);
    // Unlabeled — and the block after the failure was still placed.
    expect(familyOf((await s.read()).blocks, "nordic-pm").value).toBeNull();
    expect(familyOf((await s.read()).blocks, "cafe-baker").value?.outcome).toBe("confirmed");
  });

  it("never stores an unmapped the model did not actually give — one bad minute is not permanent", async () => {
    let answer = "not json at all";
    const s = await stack({ answerFor: () => answer });
    await s.mine();

    // Two attempts each, both refused, so nothing was stored — the block is still unanswered.
    expect(readCounters()["familyLabeler.output_invalid"]).toBe(2);
    expect(familyOf((await s.read()).blocks, "nordic-pm").value).toBeNull();

    answer = CONFIRMED; // the model comes back
    await s.mine();
    expect(familyOf((await s.read()).blocks, "nordic-pm").value?.outcome).toBe("confirmed");
  });

  it("a labeling step that throws outright never fails the upload either", async () => {
    const s = await stack({
      answerFor: () => CONFIRMED,
      labeler: async () => {
        throw new Error("the whole step fell over");
      },
    });
    const jobId = await s.mine();
    expect((await s.jobs.get(jobId))?.status).toBe("completed");
  });
});

describe("#221 AC5 — the label is correctable, and a correction outranks the machine", () => {
  async function corrected() {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    await s.mine();
    const res = await s.server.app.inject({
      method: "POST",
      url: "/job-blocks/nordic-pm/correct",
      headers: { cookie: s.cookie },
      payload: { key: "family", value: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version } },
    });
    return { s, res };
  }

  it("supersedes the machine's placement and keeps what it superseded", async () => {
    const { s, res } = await corrected();
    expect(res.statusCode).toBe(200);
    expect(res.json().downstream).toMatch(/count this job as/i);

    const family = familyOf((await s.read()).blocks, "nordic-pm");
    // A person's own answer is never hedged — it lands as certain (#231).
    expect(family.value).toEqual({
      schemaVersion: "2",
      outcome: "confirmed",
      families: [{ familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version }],
      confidence: "certain",
    });
    expect(family.origin).toEqual({
      kind: "corrected",
      supersededValue: { schemaVersion: "2", outcome: "unmapped" },
    });
  });

  it("survives a re-mine, and a re-run of the labeler never overwrites it", async () => {
    const { s } = await corrected();
    const callsBefore = s.roles.length;

    await s.mine(); // the CV read again, and the labeler run again over the same session

    expect(familyOf((await s.read()).blocks, "nordic-pm").value?.outcome).toBe("confirmed");
    // The corrected block is skipped entirely — never re-asked, so never re-spent.
    expect(s.roles).toHaveLength(callsBefore);
  });

  it("refuses a family nobody published — the closed list is enforced outside the screen", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    await s.mine();
    const res = await s.server.app.inject({
      method: "POST",
      url: "/job-blocks/nordic-pm/correct",
      headers: { cookie: s.cookie },
      payload: { key: "family", value: { familyId: "underwater-basket-weaving", version: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("unknown_family");
    expect(familyOf((await s.read()).blocks, "nordic-pm").value?.outcome).toBe("unmapped");
  });

  it("refuses a version of a real family that was never published", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    await s.mine();
    const res = await s.server.app.inject({
      method: "POST",
      url: "/job-blocks/nordic-pm/correct",
      headers: { cookie: s.cookie },
      payload: { key: "family", value: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version + 7 } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("#231 — the label's version and its confidence never touch the years fact", () => {
  // ADR-0014 amendment 1 decision 5's other half. Doubt about the LABEL must not shrink the length
  // of the work: the same job, placed with the least confidence the labeler can express, still
  // counts every month it lasted.
  it("counts the same years whether the placement is certain or only possible", async () => {
    const years = async (confidence: string) => {
      const s = await stack({ answerFor: () => confirmedAnswer([IT_DELIVERY.familyId], confidence) });
      await s.mine([minedBlock("nordic-pm", "IT Project Manager")]);
      const worked = computeYearsWorked((await s.read()).blocks, { status: "ok", blocksFound: 1 });
      return worked.state === "computed" ? worked.years : -1;
    };
    expect(await years("possible")).toBe(await years("certain"));
    expect(await years("possible")).toBeGreaterThan(0);
  });

  // A placement written under the v1 contract only ever existed on staging (#221 shipped the same
  // day #231 changed the shape). It reads as NOT PLACED, so the labeler simply places it again —
  // rather than reaching a screen that expects a `families` array and finding none.
  it("reads a placement from the old contract as unplaced, and places it again", async () => {
    const s = await stack({ answerFor: () => CONFIRMED });
    await s.mine([minedBlock("nordic-pm", "IT Project Manager")]);
    // Plant exactly what staging holds, past the writer that would only ever produce v2.
    await s.jobBlocks.label(s.sessionId, "nordic-pm", {
      schemaVersion: "1",
      outcome: "confirmed",
      family: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
    } as never);

    expect(familyOf((await s.read()).blocks, "nordic-pm").value).toBeNull();

    await s.mine([minedBlock("nordic-pm", "IT Project Manager")]);
    expect(familyOf((await s.read()).blocks, "nordic-pm").value).toMatchObject({
      schemaVersion: "2",
      outcome: "confirmed",
    });
  });
});

describe("#221 AC7 — unmapped past-job labels feed the vocabulary-growth process (#218)", () => {
  it("records the job title the vocabulary had no word for", async () => {
    const s = await stack({ answerFor: (role) => (role === "Pastry Chef" ? UNMAPPED_ANSWER : CONFIRMED) });
    await s.mine();
    expect(recentUnmappedLabelsList().map((entry) => entry.role)).toContain("Pastry Chef");
  });
});
