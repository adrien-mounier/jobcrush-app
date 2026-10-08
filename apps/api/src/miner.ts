// JC-13 claim miner: raw_cv text → validated candidate_claims. The prompt is version-controlled
// (prompts/claim-miner.md); output is schema-gated by @jobcrush/contracts. One retry with the
// validation errors appended — a second bad answer fails the job rather than shipping junk.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CandidateClaims } from "@jobcrush/contracts";
import type { RawCv } from "./extract.js";
import type { LlmClient } from "./llm.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "claim-miner.md");

let cachedPrompt: string | null = null;
export function minerPrompt(): string {
  if (!cachedPrompt) {
    // strip the HTML comment header — it's for humans reading the repo, not the model
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

export function buildMinerInput(cvText: string): string {
  return `${minerPrompt()}\n${cvText}\n`;
}

/** Tolerates prose/code fences around the JSON: takes the first { … last }. */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in miner output");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Deterministic, semantic-preserving repairs of known model slips — fixed here instead of
 * burning a retry (or failing the job) on them:
 * - Claim ids are machine-internal slugs; on non-English CVs the model emits accented ids
 *   ("edu-école-…") that fail the kebab-case regex. Normalize them.
 * - source_quote must be ≤ 200 chars (candidateClaims schema); on long CV bullets the model
 *   quotes past the cap despite the prompt. Clamp to the 200-char prefix — still a verbatim
 *   fragment of the CV, same as the grill does for answers.
 * - #323: a claim of a kind that can legitimately repeat (the prompt's rule-8 inventory ids:
 *   `edu-`, `cert-`, `lang-`, `skill-`) is never a single-valued field, whatever the model tagged
 *   it with. Left in place, two degrees sharing one field_key read as a contradiction
 *   (buildImportProof) and collapse to one at import (reconcileImport) — the owner's own CV did
 *   both. Dropping the tags here, before validation, fixes both readers at once.
 * - A null/missing semantic_key (seen on the owner's real CV, 2026-10-08: two claims, both
 *   attempts) failed the whole upload. Fall back to the claim's own id — unique, so it never
 *   merges two facts; it only forgoes deduplication for that one claim.
 */
const REPEATABLE_CLAIM_ID = /^(edu|cert|lang|skill)-/;

export function repairClaims(doc: unknown): unknown {
  if (typeof doc !== "object" || doc === null || !Array.isArray((doc as { claims?: unknown[] }).claims)) {
    return doc;
  }
  for (const claim of (doc as {
    claims: Array<{ id?: unknown; semantic_key?: unknown; source_quote?: unknown; field_key?: unknown; field_value?: unknown; field_label?: unknown }>;
  }).claims) {
    if (typeof claim?.id === "string") {
      const id =
        claim.id
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "claim";
      claim.id = id;
      if (typeof claim.semantic_key !== "string" || claim.semantic_key === "") claim.semantic_key = id;
      if (REPEATABLE_CLAIM_ID.test(id)) {
        claim.field_key = claim.field_value = claim.field_label = null;
      }
    }
    if (typeof claim?.source_quote === "string" && claim.source_quote.length > 200) {
      claim.source_quote = claim.source_quote.slice(0, 200);
    }
  }
  return doc;
}

export async function mineClaims(cvText: string, llm: LlmClient): Promise<CandidateClaims> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildMinerInput(cvText)
        : `${buildMinerInput(cvText)}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const raw = await llm.complete(input);
    try {
      return CandidateClaims.parse(repairClaims(extractJson(raw)));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new Error(`miner output failed validation twice: ${lastError.slice(0, 500)}`);
}

/** Adapter for the pipeline's mine step. */
export function makeMineStep(llm: LlmClient) {
  return async (rawCv: RawCv) => {
    const mined = await mineClaims(rawCv.fullText, llm);
    return {
      doc: mined,
      claims: mined.claims,
      roles: mined.roles.length,
      needsGrill: mined.claims.filter((c) => c.needs_grill).length,
    };
  };
}
