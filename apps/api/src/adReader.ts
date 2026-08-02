// #104 (E5 slice 3) — read an advert nobody hand-curated. One model call per posting produces the
// whole AdRequirementsV1 payload (requirements AND familyFit — #86 decision 1, never two passes).
// Same LLM-call idiom as miner.ts: a version-controlled prompt file, extractJson, a zod gate, one
// retry with the validation errors appended, throw on a second bad answer rather than ship junk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdRequirementsV1, type EligibilityDimension } from "@jobcrush/contracts";
import { extractJson } from "./miner.js";
import { canonicalModelName, type LlmClient } from "./llm.js";
import type { Posting } from "./preview.js";
import { languageEligible, SERVED_LANGUAGES } from "./language.js";
import { addToCounter, incrementCounter, recordReadFailure } from "./counters.js";
import type { AdRequirementsRecord, AdRequirementsStore } from "./adRequirementsStore.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "ad-reader.md");

// The contract half of the version is hand-bumped — packages/contracts isn't something this file
// can hash (a different repo boundary), and hand-versioning it is the existing house convention
// there. Bump this by hand whenever AdRequirementsV1 changes what a valid answer looks like.
const PROMPT_CONTRACT_VERSION = "adreq/1";

let cachedPrompt: string | null = null;
export function adReaderPrompt(): string {
  if (!cachedPrompt) {
    // strip the HTML comment header — it's for humans reading the repo, not the model
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

let cachedVersion: string | null = null;
/**
 * The version stored alongside each read. Bumping it is what triggers re-reading; an ordinary read
 * never does. The prompt half is a hash of the exact post-strip text sent to the model (#104 review
 * finding 9) rather than a hand-maintained number — editing ad-reader.md's human-facing header
 * comment (already stripped before the hash) can't accidentally trigger a full paid re-read of
 * every advert, but a real wording change always does, with nobody needing to remember to bump
 * anything. The contract half stays the explicit PROMPT_CONTRACT_VERSION above.
 */
export function adReaderVersion(): string {
  if (!cachedVersion) {
    const hash = createHash("sha256").update(adReaderPrompt()).digest("hex").slice(0, 8);
    cachedVersion = `ad-reader/${hash}+${PROMPT_CONTRACT_VERSION}`;
  }
  return cachedVersion;
}

export function buildAdReaderInput(posting: Posting, knownFamilies: string[]): string {
  const families = knownFamilies.map((f) => `- ${f}`).join("\n");
  // A function replacer — a string replacer treats "$&"/"$'"/"$1" etc. in the replacement text as
  // special patterns, and a family name is free-form input the repo doesn't control (#104 review:
  // "also fix, cheap"). families here never contains those sequences, but nothing enforces that.
  const prompt = adReaderPrompt().replace("{{KNOWN_FAMILIES}}", () => families);
  return `${prompt}\n${posting.title} at ${posting.company} (${posting.location})\n\n${posting.excerpt}\n`;
}

// Only these eligibility dimensions are hard gates (#104's code-level enforcement of the prompt's
// own blocking definition). years-experience and degree are explicitly NOT hard gates — a years bar
// or a degree preference is never a reason to withdraw a job outright, whatever the advert's wording.
const HARD_GATE_DIMENSIONS = new Set<EligibilityDimension>(["work-rights", "language", "certification"]);

/** Enforces the blocking definition in code, not only in the prompt: a `kind: "blocking"`
 *  requirement that doesn't carry a hard-gate eligibilityDimension is down-classified to
 *  "ordinary" and counted. ad-reader.md's prompt now makes this a hard rule too (every `blocking`
 *  requirement MUST set one of the three hard-gate dimensions, or it isn't blocking) — this is the
 *  mechanical backstop behind that rule, not a substitute for it, the same way this repo enforces
 *  its CV rules with conservationIssues() rather than trusting the prompt alone. A blocking miss
 *  withdraws a winnable job entirely once slice 6 acts on it, so the safe direction is enforced
 *  twice: once in the words the model reads, once in the code nothing can talk it out of. */
function clampBlocking(parsed: AdRequirementsV1): AdRequirementsV1 {
  let clamped = 0;
  const requirements = parsed.requirements.map((r) => {
    const isHardGate = r.eligibilityDimension !== undefined && HARD_GATE_DIMENSIONS.has(r.eligibilityDimension);
    if (r.kind === "blocking" && !isHardGate) {
      clamped++;
      return { ...r, kind: "ordinary" as const };
    }
    return r;
  });
  if (clamped > 0) addToCounter("adReader.blocking_clamped", clamped);
  return { ...parsed, requirements };
}

export interface AdReadCost {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Exported for judge.ts (#105) to reuse verbatim — same driver-cost-capture idiom, a different
 *  domain (judging, not reading), nothing ad-reader-specific about the function itself. */
export async function completeWithCost(llm: LlmClient, input: string): Promise<{ text: string; cost: AdReadCost }> {
  const model = canonicalModelName(llm.model ?? "unknown");
  if (llm.completeWithUsage) {
    const { text, usage } = await llm.completeWithUsage(input);
    return { text, cost: { model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } };
  }
  // No detailed method on this driver (e.g. ClaudeCliLlm) — the cost is real but unmeasured. Store
  // null, never an estimate presented as a measured number (#86's AC on the cost).
  const text = await llm.complete(input);
  return { text, cost: { model, inputTokens: null, outputTokens: null } };
}

/** Adds two nullable token counts, propagating null: once EITHER contributing attempt's usage is
 *  unmeasured, the accumulated total must read as unmeasured too — a partial sum would look like a
 *  real measured number and understate the true spend (#104 review finding 5: a retried read that
 *  only kept the last attempt's usage silently dropped roughly half of what it actually spent). */
export function addNullable(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

export interface AdReadResult {
  requirements: AdRequirementsV1;
  cost: AdReadCost;
}

/** Thrown only for the "two bad answers in a row" case at the bottom of readAdvert's loop — a
 *  distinct class from a raw LLM-call failure (network/API error), which readAdvert never catches
 *  and lets propagate as whatever error the driver itself threw. makeAdReader's catch below tells
 *  the two apart by `instanceof` rather than string-matching a message (#115 AC2: a failure records
 *  a CLASS, and model-output-invalid vs model-call-error are genuinely different operational
 *  signals — one says the prompt/contract is drifting, the other says the provider call itself
 *  failed). */
export class AdReadValidationError extends Error {}

/**
 * Reads one advert. Returns null (no model call) when the posting's language isn't served — the
 * reader must never be handed a non-served-language advert (#103's gate), but this is
 * defense-in-depth: eligiblePostings() already keeps such a posting from reaching here in
 * production. Throws after two invalid model answers, same as mineClaims — the caller decides what
 * "an advert that cannot be read" means for its own surface (makeAdReader below drops the card and
 * counts the failure).
 */
export async function readAdvert(
  posting: Posting,
  llm: LlmClient,
  knownFamilies: string[],
): Promise<AdReadResult | null> {
  if (!languageEligible(posting.language, SERVED_LANGUAGES)) {
    incrementCounter("adReader.language_skipped");
    return null;
  }

  let lastError = "";
  let costModel = "unknown";
  let totalInputTokens: number | null = 0;
  let totalOutputTokens: number | null = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildAdReaderInput(posting, knownFamilies)
        : `${buildAdReaderInput(posting, knownFamilies)}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const { text, cost } = await completeWithCost(llm, input);
    costModel = cost.model;
    // Every attempt spent real tokens, including a discarded first attempt that failed validation —
    // accumulate across the whole read, not just whichever attempt happened to succeed.
    totalInputTokens = addNullable(totalInputTokens, cost.inputTokens);
    totalOutputTokens = addNullable(totalOutputTokens, cost.outputTokens);
    try {
      const doc = extractJson(text);
      // The model's own object is spread FIRST and the pinned fields last, so an echoed
      // "curated": true or a mismatched "adId"/"schemaVersion" can never override them (#104 review
      // finding 2) — schemaVersion/adId/curated are ours to set, not the model's; see
      // ad-reader.md's header for why they're not even requested.
      const assembled = {
        ...(doc as Record<string, unknown>),
        schemaVersion: "1" as const,
        adId: posting.id,
        curated: false,
      };
      const parsed = clampBlocking(AdRequirementsV1.parse(assembled));
      addToCounter("adReader.requirements_produced", parsed.requirements.length);
      addToCounter(
        "adReader.requirements_blocking",
        parsed.requirements.filter((r) => r.kind === "blocking").length,
      );
      incrementCounter("adReader.read_succeeded");
      // Aggregate cost totals, observable on /ops/counters (#104 review finding 8) — only when this
      // whole read's usage is fully measured; a null total (no completeWithUsage on this driver)
      // stays out of the aggregate rather than being counted as a costed read with zero tokens.
      if (totalInputTokens !== null && totalOutputTokens !== null) {
        incrementCounter("adReader.cost_reads_recorded");
        addToCounter("adReader.cost_input_tokens_total", totalInputTokens);
        addToCounter("adReader.cost_output_tokens_total", totalOutputTokens);
      }
      return { requirements: parsed, cost: { model: costModel, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new AdReadValidationError(`ad reader output failed validation twice: ${lastError.slice(0, 500)}`);
}

/**
 * Wires the reader to its persisted, shared cache (#86: "nobody pays twice for the same advert").
 * A stored record at the CURRENT adReaderVersion() is reused with zero model calls; anything else
 * (never read, or read under a stale prompt/contract version) triggers exactly one read and
 * persists the result before returning it. Returns the exact `OnboardingDeps.readAd` shape —
 * main.ts wires this with the real LLM + store; tests leave it absent (today's fixture-only
 * behaviour) or inject their own fake at this same seam.
 *
 * Never throws: a failed read (model, or the store itself) is dropped (no card, no fabricated
 * number) and counted, exactly as the ticket's "an advert that cannot be read produces no card" AC
 * requires.
 */
export function makeAdReader(
  llm: LlmClient,
  store: AdRequirementsStore,
  knownFamilies: string[],
): (posting: Posting) => Promise<AdRequirementsV1 | null> {
  // Concurrent deck requests landing at cold start can both miss the store for the SAME advert
  // before either has persisted a result — without this, "nobody pays twice" only held
  // sequentially. Keyed by adId, cleared once the read settles either way (#104 review finding 7).
  const inFlight = new Map<string, Promise<AdRequirementsV1 | null>>();

  const readOne = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
    let cached: AdRequirementsRecord | null;
    try {
      cached = await store.get(posting.id);
    } catch (err) {
      // A store outage (or, before a contract bump was made version-safe, an unparseable old row)
      // must not vanish silently — count it the same as any other unreadable advert, and don't
      // blindly fall through to a paid model call that would just fail the same way on put() below
      // if the store itself is down (#104 review finding 4).
      incrementCounter("postings.read_failed");
      recordReadFailure(posting.id, "store-unavailable", err instanceof Error ? err.message : String(err));
      return null;
    }
    if (cached && cached.version === adReaderVersion()) return cached.requirements;

    let result: AdReadResult | null;
    try {
      result = await readAdvert(posting, llm, knownFamilies);
    } catch (err) {
      incrementCounter("postings.read_failed");
      recordReadFailure(
        posting.id,
        err instanceof AdReadValidationError ? "model-output-invalid" : "model-call-error",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    if (!result) return null; // language skip — already counted inside readAdvert

    try {
      await store.put(posting.id, {
        requirements: result.requirements,
        version: adReaderVersion(),
        cost: { ...result.cost, readAt: new Date().toISOString() },
      });
    } catch (err) {
      // The read itself succeeded and was already paid for — a storage outage shouldn't throw away
      // a good result the caller can still use THIS request. It does mean the read won't be shared
      // (the next request re-reads), so count it the same as any other unreadable-advert outcome.
      incrementCounter("postings.read_failed");
      recordReadFailure(posting.id, "store-unavailable", err instanceof Error ? err.message : String(err));
    }
    return result.requirements;
  };

  return (posting) => {
    const existing = inFlight.get(posting.id);
    if (existing) return existing;
    const promise = readOne(posting).finally(() => inFlight.delete(posting.id));
    inFlight.set(posting.id, promise);
    return promise;
  };
}
