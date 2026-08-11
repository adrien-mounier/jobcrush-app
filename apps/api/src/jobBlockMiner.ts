// #161 job-block miner: raw CV text -> validated MinedJobBlocks. Sibling to miner.ts (JC-13's
// claim miner) but scoped to the dated blocks only — jobs, education, projects, client
// engagements, volunteering — decomposed into their five atomic decisions (packages/contracts/src/
// jobBlock.ts). One retry with validation errors appended, same shape as miner.ts.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MinedJobBlocks } from "@jobcrush/contracts";
import type { RawCv } from "./extract.js";
import type { LlmClient } from "./llm.js";
import { extractJson } from "./miner.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "job-block-miner.md");

let cachedPrompt: string | null = null;
export function jobBlockMinerPrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

export function buildJobBlockMinerInput(cvText: string): string {
  return `${jobBlockMinerPrompt()}\n${cvText}\n`;
}

/** Same slug + quote-length repairs as claim-miner (miner.ts's repairClaims), applied to every
 *  block's five decisions instead of a flat claims array. */
export function repairJobBlocks(doc: unknown): unknown {
  if (typeof doc !== "object" || doc === null || !Array.isArray((doc as { blocks?: unknown[] }).blocks)) {
    return doc;
  }
  const clampQuote = (d: unknown) => {
    if (d && typeof d === "object" && typeof (d as { source_quote?: unknown }).source_quote === "string") {
      const s = (d as { source_quote: string }).source_quote;
      if (s.length > 200) (d as { source_quote: string }).source_quote = s.slice(0, 200);
    }
  };
  for (const block of (doc as { blocks: Array<Record<string, unknown>> }).blocks) {
    if (typeof block?.id === "string") {
      block.id =
        block.id
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "block";
    }
    for (const key of ["employer", "title", "start", "kind"]) clampQuote(block[key]);
    const end = block.end as { source_quote?: unknown } | undefined;
    if (end && typeof end.source_quote === "string" && end.source_quote.length > 200) {
      end.source_quote = end.source_quote.slice(0, 200);
    }
  }
  return doc;
}

export async function mineJobBlocks(cvText: string, llm: LlmClient): Promise<MinedJobBlocks> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildJobBlockMinerInput(cvText)
        : `${buildJobBlockMinerInput(cvText)}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const raw = await llm.complete(input);
    try {
      return MinedJobBlocks.parse(repairJobBlocks(extractJson(raw)));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new Error(`job-block miner output failed validation twice: ${lastError.slice(0, 500)}`);
}

/** Adapter for a pipeline step: also returns the raw LLM text so the caller can persist it
 *  unparsed beside the parsed records (owner decision 2026-08-11 — re-parsing later must never be
 *  the only way to evolve the shape, and it can destroy a person's earlier corrections). */
export function makeMineJobBlocksStep(llm: LlmClient) {
  return async (rawCv: RawCv): Promise<{ doc: MinedJobBlocks; rawOutput: string }> => {
    let rawOutput = "";
    const capturingLlm: LlmClient = {
      ...llm,
      complete: async (prompt, opts) => {
        const text = await llm.complete(prompt, opts);
        rawOutput = text; // last attempt's raw text — the one that actually parsed
        return text;
      },
    };
    const doc = await mineJobBlocks(rawCv.fullText, capturingLlm);
    return { doc, rawOutput };
  };
}
