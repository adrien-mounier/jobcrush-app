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
// #107 (E5 slice 6, D1) bumped 1 -> 2: the prompt now requires eligibilitySubject on a blocking
// language/certification requirement, so a stored row read under the OLD prompt (which never asked
// for one) must be treated as stale and re-read, not silently reused with an absent subject.
// #165 bumped this from "adreq/2": AdRequirementV1 gained `eligibilityLevel` (which rung of the
// language ladder an advert actually tests), so every advert already stored under the old contract
// was read by a prompt that could not produce it. The bump is the ticket's whole re-read cost
// mechanism — it makes stored reads stale, and makeAdReader re-reads each one LAZILY, at most once,
// the next time some visitor actually looks at that advert. Nothing is re-read in bulk, and an
// advert nobody opens is never paid for again.
const PROMPT_CONTRACT_VERSION = "adreq/3";

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

// #107 (E5 slice 6, D1): the SECOND thing a blocking language/certification requirement must carry —
// a hard-gate dimension alone says WHICH KIND of gate this is, not WHICH language or certification.
// Without a subject, "blocking" on "language" would be matched against whatever the visitor answered
// for ANY language once slice 6's withdrawal predicate (withdrawal.ts) acts on it — Mandarin matched
// against an English answer, silently deleting a winnable job (#86's own "worst failure" case).
// work-rights is excluded: the fact is global, so it never carries (or needs) a subject.
const SUBJECT_REQUIRED_DIMENSIONS = new Set<EligibilityDimension>(["language", "certification"]);

/** Enforces the blocking definition in code, not only in the prompt: a `kind: "blocking"`
 *  requirement that doesn't carry a hard-gate eligibilityDimension is down-classified to
 *  "ordinary" and counted — and (#107, D1) so is a blocking `language`/`certification` requirement
 *  that carries a hard-gate dimension but NO `eligibilitySubject` (see SUBJECT_REQUIRED_DIMENSIONS's
 *  own doc for why). ad-reader.md's prompt now makes both a hard rule too (every `blocking`
 *  requirement MUST set one of the three hard-gate dimensions, and a blocking language/certification
 *  one MUST also set a subject) — this is the mechanical backstop behind those rules, not a
 *  substitute for them, the same way this repo enforces its CV rules with conservationIssues()
 *  rather than trusting the prompt alone. A blocking miss withdraws a winnable job entirely once
 *  slice 6 acts on it, so the safe direction is enforced twice: once in the words the model reads,
 *  once in the code nothing can talk it out of. */
function clampBlocking(parsed: AdRequirementsV1): AdRequirementsV1 {
  let clamped = 0;
  const requirements = parsed.requirements.map((raw) => {
    // #165: two ways `eligibilityLevel` can arrive meaningless, both stripped here rather than
    // trusted to the prompt. A level on a non-language requirement has nothing to grade; a level of
    // "not-at-all" would have the advert asking for someone who does NOT speak the language — that
    // rung exists only on the visitor's side of the ladder, as their explicit "I don't speak this".
    const r =
      raw.eligibilityLevel !== undefined &&
      (raw.eligibilityDimension !== "language" || raw.eligibilityLevel === "not-at-all")
        ? { ...raw, eligibilityLevel: undefined }
        : raw;
    // T3 (code review): `dimension` re-checked against `undefined` inline in EACH boolean below,
    // rather than computed once and reused behind a `!` assertion — TS narrows it within its own
    // `&&` chain, so a later edit that loosens either guard is a compile error, not a runtime one.
    const dimension = r.eligibilityDimension;
    const isHardGate = dimension !== undefined && HARD_GATE_DIMENSIONS.has(dimension);
    const missingSubject = dimension !== undefined && SUBJECT_REQUIRED_DIMENSIONS.has(dimension) && !r.eligibilitySubject;
    if (r.kind === "blocking" && (!isHardGate || missingSubject)) {
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

// #114: a negative cache with a bounded, escalating backoff — only for the readAdvert THROW path
// below (the one that actually costs up to two model calls per attempt). A store outage, a
// store.put failure after a successful read, and the free language-skip null are all deliberately
// excluded from this cache — see makeAdReader's own doc for why each one is excluded on its own
// terms; none of them are "an advert the model cannot parse", the one thing this cache exists to
// stop paying for repeatedly.
export interface SuppressionEntry {
  // The adReaderVersion() this failure was recorded under. Compared on lookup as defense-in-depth
  // against a future where the version COULD move within a running process — see isSuppressionActive's
  // own doc for why it is NOT the live mechanism preventing a fixed advert from staying invisible
  // forever; that job belongs to retryAt/SUPPRESSION_MAX_MS below.
  version: string;
  retryAt: number; // epoch ms — before this, a request for this adId is suppressed
  failureCount: number; // consecutive failures at THIS version — drives the backoff exponent
}

// Base + cap chosen so a TRANSIENT failure (a single bad model answer, a network blip — the common
// case; see AdReadValidationError's own doc on how rare two-bad-answers-in-a-row is meant to be)
// still retries within a couple of minutes rather than making a visitor watch a card stay missing
// for an hour, while an advert the model can NEVER parse converges toward rare retries instead of a
// flat cadence forever (doubling: 2, 4, 8, 16, 32, capped at 60 minutes). Exported so tests can
// compute exact expected offsets instead of duplicating these numbers as separate literals.
export const SUPPRESSION_BASE_MS = 2 * 60_000;
export const SUPPRESSION_MAX_MS = 60 * 60_000;
// Bounds the negative cache's size the same way counters.ts bounds its recent-read-failures ring
// buffer — a live feed (#99-#101) could otherwise grow this Map unboundedly across a long-running
// process. Generous headroom over today's 17-posting fixture pool.
const SUPPRESSION_MAX_ENTRIES = 500;

/** Pure — escalating backoff for the Nth consecutive failure at the same version, base × 2^(n−1)
 *  capped at SUPPRESSION_MAX_MS. Exported and tested directly for the same reason
 *  computeReadFailureAlarm (counters.ts) is pure: exact-number testability without needing a live
 *  makeAdReader closure. */
export function computeSuppressionBackoffMs(failureCount: number): number {
  return Math.min(SUPPRESSION_BASE_MS * 2 ** (failureCount - 1), SUPPRESSION_MAX_MS);
}

/** Pure — whether an existing suppression entry still applies right now, against the reader's
 *  CURRENT version. Either an expired retryAt or a version mismatch means "stale" — the entry no
 *  longer suppresses, whatever its failureCount.
 *
 *  The OPERATIVE guarantee against AC4 ("a previously-failing advert is retried after a
 *  prompt/contract bump, never left permanently invisible") is the expired-retryAt half alone,
 *  because SUPPRESSION_MAX_MS caps the backoff — every suppressed advert is retried again within
 *  the hour regardless of whether the version ever changes. Review correction: the version-mismatch
 *  half is NOT a live guard in production today. adReaderVersion() is a memoised hash of a fixed
 *  on-disk prompt file plus a hand-bumped constant — it cannot change within a running process. A
 *  real prompt/contract bump only takes effect through a redeploy, and a redeploy restarts the
 *  process, which empties this whole in-memory negativeCache (a fresh Map, module-scoped inside
 *  makeAdReader) anyway — so by the time a NEW version is actually running, there is no stale entry
 *  left for it to rescue; the cache starts cold. The version field and comparison stay here as
 *  defense-in-depth for a future where the version genuinely could move within a live process (e.g.
 *  a hot-reloadable prompt), not because today's production path can ever exercise that branch.
 *
 *  Takes `currentVersion`/`now` explicitly, the same "pure, exact-input testable" shape counters.ts's
 *  own alarm functions use, rather than reaching for adReaderVersion()/Date.now() itself — this is
 *  what makes the (currently unreachable) version-mismatch branch provably correct as CODE even
 *  though no live seam exists to exercise it end-to-end from a test. */
export function isSuppressionActive(entry: SuppressionEntry, currentVersion: string, now: number): boolean {
  return entry.version === currentVersion && now < entry.retryAt;
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
 *
 * #114: a readAdvert failure is ALSO remembered in a bounded, escalating-backoff negative cache (see
 * SuppressionEntry above), so an advert the model can't parse doesn't cost up to two model calls on
 * every single request for it — only a store outage / store.put failure / language-skip null are
 * excluded from that cache; see readOne's own comments at each of those sites for why.
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

  // #114: the negative cache — an adId that recently failed readAdvert maps to when it may next be
  // retried. Checked/written only around the readAdvert call below; see SuppressionEntry's own doc
  // for exactly which failure paths this does and does not cover.
  const negativeCache = new Map<string, SuppressionEntry>();

  function recordSuppression(adId: string): void {
    const existing = negativeCache.get(adId);
    // A failure at a DIFFERENT version than the last one recorded starts the backoff over at 1 —
    // the previous failure count was measured against a prompt/contract that no longer applies, so
    // it says nothing about how likely THIS version is to keep failing.
    const failureCount = existing && existing.version === adReaderVersion() ? existing.failureCount + 1 : 1;
    negativeCache.set(adId, {
      version: adReaderVersion(),
      retryAt: Date.now() + computeSuppressionBackoffMs(failureCount),
      failureCount,
    });
    // Bounded the same way counters.ts bounds its recent-read-failures ring buffer. Map iteration
    // order is insertion order, and .set() on an already-present key does not move it, so this is a
    // simple FIFO eviction (oldest entry falls off first) — good enough for a safety-net cap, not
    // meant to be precise LRU.
    if (negativeCache.size > SUPPRESSION_MAX_ENTRIES) {
      const oldestKey = negativeCache.keys().next().value;
      if (oldestKey !== undefined) negativeCache.delete(oldestKey);
    }
  }

  const readOne = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
    let cached: AdRequirementsRecord | null;
    try {
      cached = await store.get(posting.id);
    } catch (err) {
      // A store outage (or, before a contract bump was made version-safe, an unparseable old row)
      // must not vanish silently — count it the same as any other unreadable advert, and don't
      // blindly fall through to a paid model call that would just fail the same way on put() below
      // if the store itself is down (#104 review finding 4). Deliberately NOT negatively cached — no
      // model call happened, so suppressing the NEXT attempt would only delay recovery from what
      // might be a momentary store blip, saving nothing.
      incrementCounter("postings.read_failed");
      recordReadFailure(posting.id, "store-unavailable", err instanceof Error ? err.message : String(err));
      return null;
    }
    if (cached && cached.version === adReaderVersion()) return cached.requirements;

    const suppressed = negativeCache.get(posting.id);
    if (suppressed) {
      if (isSuppressionActive(suppressed, adReaderVersion(), Date.now())) {
        incrementCounter("adReader.read_suppressed");
        return null;
      }
      // Stale — the backoff window passed, which is the operative guarantee against a permanently
      // -broken advert going silent forever (SUPPRESSION_MAX_MS bounds it). A stale VERSION mismatch
      // is handled by the exact same branch below defense-in-depth (see isSuppressionActive's own
      // doc for why that half is unreachable in production today). Either way this advert gets
      // exactly one more attempt below. Deliberately NOT deleted here (only overwritten by
      // recordSuppression on a fresh failure, or explicitly deleted below on a genuine success) —
      // recordSuppression's own failureCount logic needs the PRIOR entry still present to tell
      // "still failing at the same version, escalate the backoff" apart from "version moved, start
      // the backoff over".
      incrementCounter("adReader.read_suppression_lifted");
    }

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
      recordSuppression(posting.id);
      return null;
    }
    if (!result) return null; // language skip — already counted inside readAdvert; never suppressed
    // (no model call was made, so there is nothing a negative cache entry would save)

    // #114 review must-fix 4: a genuine success must clear any lingering suppression entry for this
    // adId right now, not leave it to go stale on its own. Left in place, a SUBSEQUENT store.put
    // failure below (a real but different failure mode — see its own comment) would otherwise find
    // the entry still sitting there on the NEXT request: read_suppression_lifted would fire again
    // for a "suppression" that was never re-armed, and if that next attempt failed, recordSuppression
    // would resume escalating failureCount from a number a real success already disproved.
    negativeCache.delete(posting.id);

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
