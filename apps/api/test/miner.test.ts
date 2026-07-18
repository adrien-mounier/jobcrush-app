import { describe, expect, it } from "vitest";
import { CandidateClaims } from "@jobcrush/contracts";
import { buildMinerInput, extractJson, mineClaims } from "../src/miner.js";
import type { LlmClient } from "../src/llm.js";

const validDoc = {
  schemaVersion: "0",
  roles: [{ employer: "Acme", title: "PM", dates_as_written: "2020-2024", dates_missing: false }],
  claims: [
    {
      id: "acme-delivery",
      role: "Acme — PM",
      text: "Delivered the migration on schedule",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "Delivered the migration on schedule",
      needs_grill: false,
      grill_hint: null,
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

describe("JC-13 miner plumbing", () => {
  it("prompt ends with the data marker and embeds the CV after it", () => {
    const input = buildMinerInput("MY CV TEXT");
    expect(input).toContain("===CV-TEXT===");
    expect(input.indexOf("MY CV TEXT")).toBeGreaterThan(input.indexOf("===CV-TEXT==="));
    expect(input).not.toContain("<!--"); // human header stripped
  });

  it("extractJson tolerates fences and prose around the object", () => {
    const wrapped = "Here you go:\n```json\n" + JSON.stringify(validDoc) + "\n```\nDone!";
    expect(CandidateClaims.parse(extractJson(wrapped))).toBeTruthy();
  });

  it("schema invariant: inferred claims must set needs_grill", () => {
    const bad = structuredClone(validDoc);
    bad.claims[0].machine_touch = "inferred";
    expect(() => CandidateClaims.parse(bad)).toThrow(/needs_grill/);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const llm = fakeLlm(["not json at all", JSON.stringify(validDoc)]);
    const mined = await mineClaims("cv text", llm);
    expect(mined.claims).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("===RETRY===");
  });

  it("fails after two invalid answers instead of shipping junk", async () => {
    const llm = fakeLlm(["{}", "{}"]);
    await expect(mineClaims("cv text", llm)).rejects.toThrow(/failed validation twice/);
  });

  it("normalizes accented/messy claim ids to kebab-case instead of burning a retry", async () => {
    const doc = structuredClone(validDoc);
    doc.claims[0].id = "edu-École-Supérieure_PL/300";
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineClaims("cv text", llm);
    expect(mined.claims[0]!.id).toBe("edu-ecole-superieure-pl-300");
    expect(llm.calls).toHaveLength(1);
  });

  it("clamps an over-long source_quote to 200 chars instead of failing the job", async () => {
    const doc = structuredClone(validDoc);
    doc.claims[0].source_quote = "x".repeat(250);
    const llm = fakeLlm([JSON.stringify(doc)]);
    const mined = await mineClaims("cv text", llm);
    expect(mined.claims[0]!.source_quote).toBe("x".repeat(200));
    expect(llm.calls).toHaveLength(1);
  });
});
