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

const CONFIRMED = JSON.stringify({ outcome: "confirmed", familyId: IT_DELIVERY.familyId });
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

  const read = async (): Promise<{ blocks: JobBlockView[]; families: Array<{ familyId: string; label: string }> }> =>
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
      schemaVersion: "1",
      outcome: "confirmed",
      family: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
    });
    // Honestly unmapped rather than pushed into the nearest family (ADR-0014 decision 1).
    expect(familyOf(blocks, "cafe-baker").value).toEqual({ schemaVersion: "1", outcome: "unmapped" });
    // The label quotes no source words — it was worked out, not read (#221's own wording).
    expect(familyOf(blocks, "nordic-pm").origin).toEqual({ kind: "worked_out" });
  });

  it("stores a needs-clarification placement AS-IS, with its choices — the machine never picks", async () => {
    const s = await stack({
      families: TWO_FAMILIES,
      answerFor: () =>
        JSON.stringify({ outcome: "needs_clarification", familyIds: TWO_FAMILIES.map((f) => f.familyId) }),
    });
    await s.mine();
    const placement = familyOf((await s.read()).blocks, "nordic-pm").value;

    expect(placement?.outcome).toBe("needs_clarification");
    expect(placement?.outcome === "needs_clarification" && placement.choices.map((c) => c.label)).toEqual([
      IT_DELIVERY.label,
      "Product management",
    ]);
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

  it("serves the published families with the deck, so the screen can offer real choices", async () => {
    const s = await stack({ answerFor: () => UNMAPPED_ANSWER });
    expect((await s.read()).families).toEqual([
      { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version, label: IT_DELIVERY.label },
    ]);
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
    expect(family.value).toEqual({
      schemaVersion: "1",
      outcome: "confirmed",
      family: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
    });
    expect(family.origin).toEqual({
      kind: "corrected",
      supersededValue: { schemaVersion: "1", outcome: "unmapped" },
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

describe("#221 AC7 — unmapped past-job labels feed the vocabulary-growth process (#218)", () => {
  it("records the job title the vocabulary had no word for", async () => {
    const s = await stack({ answerFor: (role) => (role === "Pastry Chef" ? UNMAPPED_ANSWER : CONFIRMED) });
    await s.mine();
    expect(recentUnmappedLabelsList().map((entry) => entry.role)).toContain("Pastry Chef");
  });
});
