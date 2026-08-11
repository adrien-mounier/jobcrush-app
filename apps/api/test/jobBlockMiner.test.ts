import { describe, expect, it } from "vitest";
import { MinedJobBlocks } from "@jobcrush/contracts";
import { buildJobBlockMinerInput, makeMineJobBlocksStep, mineJobBlocks } from "../src/jobBlockMiner.js";
import type { LlmClient } from "../src/llm.js";

const decision = (over: Record<string, unknown> = {}) => ({
  value: "Standard Chartered",
  source_quote: "Standard Chartered Bank",
  machine_touch: "verbatim",
  classification: "Verified",
  ...over,
});

const validDoc = {
  schemaVersion: "1",
  blocks: [
    {
      id: "block-1",
      employer: decision(),
      title: decision({ value: "Regional PM", source_quote: "Regional Project Manager" }),
      start: decision({ value: { year: 2019, month: 1, precision: "month" }, source_quote: "Jan 2019" }),
      end: {
        value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } },
        source_quote: "Mar 2022",
        machine_touch: "verbatim",
        classification: "Verified",
      },
      kind: decision({ value: "job", source_quote: "Regional Project Manager, Standard Chartered" }),
    },
  ],
  parser_flags: [],
};

function fakeLlm(responses: string[]): LlmClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete(prompt: string) {
      calls.push(prompt);
      const next = responses.shift();
      if (next === undefined) throw new Error("fake llm exhausted");
      return next;
    },
  };
}

describe("#161 job-block miner plumbing", () => {
  it("prompt ends with the data marker and embeds the CV after it", () => {
    const input = buildJobBlockMinerInput("MY CV TEXT");
    expect(input).toContain("===CV-TEXT===");
    expect(input.indexOf("MY CV TEXT")).toBeGreaterThan(input.indexOf("===CV-TEXT==="));
    expect(input).not.toContain("<!--");
  });

  it("parses a valid mined document", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks).toHaveLength(1);
    expect(MinedJobBlocks.safeParse(mined).success).toBe(true);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const llm = fakeLlm(["not json at all", JSON.stringify(validDoc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("===RETRY===");
  });

  it("fails after two invalid answers instead of shipping junk", async () => {
    const llm = fakeLlm(["{}", "{}"]);
    await expect(mineJobBlocks("cv text", llm)).rejects.toThrow(/failed validation twice/);
  });

  // AC: "2021 – 2023" stores year-level precision, no invented months.
  it("accepts a year-only date with month explicitly null", async () => {
    const doc = structuredClone(validDoc);
    doc.blocks[0].start = decision({ value: { year: 2021, month: null, precision: "year" }, source_quote: "2021" });
    doc.blocks[0].end = {
      value: { state: "ended", date: { year: 2023, month: null, precision: "year" } },
      source_quote: "2023",
      machine_touch: "verbatim",
      classification: "Verified",
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks[0]!.start.value).toEqual({ year: 2021, month: null, precision: "year" });
  });

  // AC: no end date -> explicit "unknown", distinct from "still there" (ongoing).
  it("accepts an explicit unknown end, distinct from ongoing", async () => {
    const doc = structuredClone(validDoc);
    doc.blocks[0].end = {
      value: { state: "unknown" },
      source_quote: null,
      machine_touch: "verbatim",
      classification: "Verified",
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks[0]!.end.value).toEqual({ state: "unknown" });
  });

  // AC: a CV where the miner found no dated jobs — the read ran and found none.
  it("accepts an empty blocks array with a parser flag naming the negative result", async () => {
    const doc = { schemaVersion: "1", blocks: [], parser_flags: ["no-dated-jobs-found"] };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks).toEqual([]);
    expect(mined.parser_flags).toContain("no-dated-jobs-found");
  });

  it("normalizes accented/messy block ids to kebab-case instead of burning a retry", async () => {
    const doc = structuredClone(validDoc);
    doc.blocks[0].id = "role-École-Supérieure/2019";
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineJobBlocks("cv text", llm);
    expect(mined.blocks[0]!.id).toBe("role-ecole-superieure-2019");
    expect(llm.calls).toHaveLength(1);
  });

  it("makeMineJobBlocksStep surfaces the raw LLM text alongside the parsed doc", async () => {
    const raw = JSON.stringify(validDoc);
    const llm = fakeLlm([raw]);
    const step = makeMineJobBlocksStep(llm);
    const result = await step({ fullText: "cv text" } as never);
    expect(result.doc.blocks).toHaveLength(1);
    expect(result.rawOutput).toBe(raw);
  });
});
