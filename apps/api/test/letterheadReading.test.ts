// #451 (spec #450) — the letterhead reading: at upload the model reads the person's name and city
// from the top of the CV, as the CV writes them; email and phone stay deterministic (#190).
//
// Tested at the pipeline seam with a fake model at the LLM seam (prior art: jobBlockLabeling.test.ts):
// the step is built by makeReadLetterheadStep exactly as main.ts builds it, the CV goes in through
// POST /cv/paste, and what landed is read back from the contact store — the record Your details
// shows. A test that wants a particular reading makes the FAKE MODEL say it; nothing asserts prompt
// wording.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryContactStore } from "../src/contact.js";
import { InMemoryJobStore, isTerminal, type JobRecord } from "../src/jobs.js";
import { runOnboardingJob, type PipelineDeps } from "../src/pipeline.js";
import { makeReadLetterheadStep } from "../src/letterheadReader.js";
import { meterLlm } from "../src/llmMeter.js";
import { InMemoryUsageLedgerStore } from "../src/usageLedgerStore.js";
import { CONTACT_FIELDS } from "../src/contact.js";
import type { LlmClient } from "../src/llm.js";
import type { RawCv } from "../src/extract.js";

const CV = [
  "J A N E  D O E",
  "jane@example.com | +44 7700 900000",
  "London, UK",
  "",
  "Experience",
  "Product Owner, Acme — Jan 2020 - Present",
  "- Led delivery in Manchester, UK",
].join("\n");

type Field = { value: string; source_quote: string } | null;
const answer = (name: Field, location: Field) => JSON.stringify({ name, location });
const quoted = (value: string) => ({ value, source_quote: value });

/** Counts calls — the checkpoint test asserts on that count, the only thing "a retry re-spends
 *  nothing" can mean from outside. `reply` may throw to play a failed call. */
function fakeLlm(reply: () => string | Promise<string>) {
  const calls: string[] = [];
  const llm: LlmClient = {
    model: "fake-model",
    async complete(prompt) {
      calls.push(prompt);
      return reply();
    },
  };
  return { llm, calls };
}

async function stack(reply: () => string | Promise<string>, extra: Partial<PipelineDeps> = {}) {
  const { llm, calls } = fakeLlm(reply);
  const server = buildServer({ pipeline: { readLetterhead: makeReadLetterheadStep(llm), ...extra } });
  const res = await server.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  const sessionId = (await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
  const paste = async (text = CV) => {
    const { jobId } = (await server.app.inject({ method: "POST", url: "/cv/paste", headers: { cookie }, payload: { text } })).json();
    return new Promise<JobRecord>((resolve) => {
      const settle = (job: JobRecord | null) => {
        if (job && isTerminal(job.status)) {
          un();
          resolve(job);
        }
      };
      const un = server.store.subscribe(jobId, settle);
      void server.store.get(jobId).then(settle);
    });
  };
  return { server, sessionId, calls, paste, record: () => server.contact.getRecord(sessionId) };
}

describe("#451 the letterhead reading — name and city from the model, email and phone as before", () => {
  it("stores the name and city the model read, as the CV writes them, and email/phone from the exact reader", async () => {
    const { paste, record } = await stack(() => answer(quoted("John Smith, PMP"), quoted("Lausanne")));
    const cv = "John Smith, PMP\njohn@example.com | +41 79 000 00 00\nLausanne\n\nExperience\nPM at X, 2020 - 2024\n- Led delivery of the checkout replatform across three vendor teams";
    const job = await paste(cv);
    expect(job.status).toBe("completed");
    expect(await record()).toMatchObject({
      name: { value: "John Smith, PMP", origin: "read", sourceText: "John Smith, PMP" },
      location: { value: "Lausanne", origin: "read", sourceText: "Lausanne" },
      email: { value: "john@example.com", origin: "read" },
      phone: { value: "+41 79 000 00 00", origin: "read" },
    });
  });

  it("joins a letter-spaced name, keeping the CV's own letters as the source", async () => {
    const { paste, record } = await stack(() => answer({ value: "JANE DOE", source_quote: "J A N E  D O E" }, quoted("London, UK")));
    await paste();
    expect((await record()).name).toEqual({ value: "JANE DOE", origin: "read", sourceText: "J A N E  D O E" });
  });

  it("drops a field whose quote is not in the CV, or whose value is not its quote — nothing is added silently", async () => {
    const { paste, record } = await stack(() =>
      // the name's quote was never in the CV; the city's value is a rewording of its quote
      answer({ value: "Jane Doe", source_quote: "Jane Doe" }, { value: "London", source_quote: "London, UK" }),
    );
    await paste();
    const got = await record();
    expect(got.name).toBeNull();
    expect(got.location).toBeNull();
    expect(got.email).toMatchObject({ value: "jane@example.com" }); // the exact reader is untouched
  });

  it.each([
    ["a thrown call (timeout)", () => Promise.reject(new Error("timeout"))],
    ["an unreadable answer", () => "not json at all"],
  ])("%s leaves name and city unwritten, the upload completes, and nothing is said to the person", async (_, reply) => {
    const { paste, record } = await stack(reply);
    const job = await paste();
    expect(job.status).toBe("completed");
    const got = await record();
    expect(got.name).toBeNull();
    expect(got.location).toBeNull();
    expect(got.phone).toMatchObject({ value: "+44 7700 900000" });
    expect((job.progress.feed as string[]).join("\n")).not.toMatch(/name|city|letterhead/i);
  });

  it("a name the person typed survives a re-upload (read never overwrites person-said)", async () => {
    const { server, sessionId, paste, record } = await stack(() => answer(quoted("J A N E  D O E"), quoted("London, UK")));
    await server.contact.put(sessionId, "name", { value: "Jane Doe-Smith", origin: "person-said", sourceText: "Jane Doe-Smith" });
    await paste();
    expect((await record()).name).toEqual({ value: "Jane Doe-Smith", origin: "person-said", sourceText: "Jane Doe-Smith" });
    expect((await record()).location).toMatchObject({ value: "London, UK", origin: "read" });
  });

  it("the reading runs at the same time as the job-history reading, not after it", async () => {
    const events: string[] = [];
    const { paste } = await stack(
      async () => {
        events.push("letterhead:start");
        await new Promise((r) => setTimeout(r, 20));
        events.push("letterhead:end");
        return answer(quoted("J A N E  D O E"), null);
      },
      {
        mineJobBlocks: async () => {
          events.push("jobBlocks:start");
          await new Promise((r) => setTimeout(r, 20));
          events.push("jobBlocks:end");
          return { doc: { schemaVersion: "1", blocks: [], parser_flags: [] }, rawOutput: "raw" };
        },
      },
    );
    await paste();
    expect(events.slice(0, 2).sort()).toEqual(["jobBlocks:start", "letterhead:start"]);
  });
});

describe("#451 checkpoint and ledger", () => {
  /** The pipeline run directly on a job store, with the server's own read-path write (server.ts's
   *  persistContact default is the CONTACT_FIELDS loop; the same loop here). */
  function deps(llm: LlmClient, contact: InMemoryContactStore): PipelineDeps {
    return {
      readLetterhead: makeReadLetterheadStep(llm),
      persistContact: async (sid, fields) => {
        for (const field of CONTACT_FIELDS) {
          const read = fields[field];
          if (read) await contact.put(sid, field, { ...read, origin: "read" });
        }
      },
    };
  }

  it("a retried upload after the checkpoint makes no second call", async () => {
    const { llm, calls } = fakeLlm(() => answer(quoted("J A N E  D O E"), null));
    const contact = new InMemoryContactStore();
    const jobs = new InMemoryJobStore();
    const job = await jobs.create("onboarding", "sess-1");
    await runOnboardingJob(jobs, job.id, { type: "paste", text: CV }, deps(llm, contact));
    expect(calls).toHaveLength(1);
    expect((await jobs.get(job.id))?.progress.letterhead).toBeTruthy();

    await runOnboardingJob(jobs, job.id, { type: "paste", text: CV }, deps(llm, contact));
    expect(calls).toHaveLength(1);
    expect(await contact.get("sess-1", "name")).toMatchObject({ value: "J A N E  D O E" });
  });

  it("hands the model the top of the CV's full text, not the letterhead slice", async () => {
    const { llm, calls } = fakeLlm(() => answer(null, null));
    const rawCv: RawCv = {
      source: "paste",
      status: "ok",
      fullText: "x".repeat(3000),
      blocks: [],
      stats: { roles: 0, bullets: 0, chars: 3000, pages: null },
    };
    await makeReadLetterheadStep(llm)(rawCv);
    expect(calls[0]).toContain("x".repeat(2000));
    expect(calls[0]).not.toContain("x".repeat(2001));
  });

  it("each call is priced into the usage ledger under its own stage", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const base = fakeLlm(() => answer(quoted("J A N E  D O E"), null)).llm;
    base.completeWithUsage = async () => ({ text: answer(quoted("J A N E  D O E"), null), usage: { inputTokens: 1100, outputTokens: 100 } });
    const metered = meterLlm(base, "letterhead-reading", ledger, { "fake-model": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    const contact = new InMemoryContactStore();
    const jobs = new InMemoryJobStore();
    const job = await jobs.create("onboarding", "sess-1");
    await runOnboardingJob(jobs, job.id, { type: "paste", text: CV }, deps(metered, contact));
    await metered.flushForTest();
    expect((await ledger.costByStage())["letterhead-reading"]).toBeCloseTo(0.0033 + 0.0015, 8);
  });
});
