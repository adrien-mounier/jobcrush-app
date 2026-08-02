// #105 (E5 slice 4) — meaning-aware judging. Same idiom as adReader.ts (#104): a version-controlled
// prompt file, one model call, extractJson + a zod gate + one retry, a persisted shared cache keyed
// by a version string, cost captured per record, counters, never-throws wiring, an in-flight dedup
// map. This is the ONE surgical change #86/#105 ask for: a per-requirement graded verdict replaces
// matchtick.ts's token-overlap `requirementFit` when a judge is wired — matchtick.ts itself is
// untouched, and every route that doesn't wire a judge (every pre-#105 test) keeps today's
// deterministic tick exactly as it is.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { extractJson } from "./miner.js";
import { completeWithCost, addNullable, type AdReadCost } from "./adReader.js";
import { canonicalModelName, type LlmClient } from "./llm.js";
import { addToCounter, incrementCounter } from "./counters.js";
import type { JudgementRecord, JudgementStore } from "./judgementStore.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "card-judge.md");

// Hand-bumped, same idiom as adReader.ts's PROMPT_CONTRACT_VERSION: bump this whenever the verdict
// shape (JudgeVerdict below) changes what a valid answer looks like.
const PROMPT_CONTRACT_VERSION = "judge/1";

let cachedPrompt: string | null = null;
export function judgePrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

let cachedVersion: string | null = null;
/** Same rationale as adReaderVersion(): a hash of the exact post-strip prompt text plus the
 *  hand-maintained contract half, so editing the prompt's human-facing header can never
 *  accidentally trigger a full paid re-judge, but a real wording change always does. */
export function judgeVersion(): string {
  if (!cachedVersion) {
    const hash = createHash("sha256").update(judgePrompt()).digest("hex").slice(0, 8);
    cachedVersion = `card-judge/${hash}+${PROMPT_CONTRACT_VERSION}`;
  }
  return cachedVersion;
}

/** Anything with a stable id and CV-line-shaped text — a confirmed claim, a negative claim, or a
 *  plain fixture in tests. Deliberately looser than ClaimRecord, mirroring matchtick.ts's
 *  ScoredFact, but WITH an id: the judge needs to name which fact supported a verdict. */
export interface JudgeFact {
  id: string;
  text: string;
}

// #105 review finding 7: a fact's text is user-authored free text (a discovery/tailor answer),
// interpolated directly next to this prompt's own structural markers (`===...===` block delimiters,
// `- id: …` list items). Without this, an answer whose text happens to contain a forged marker or
// list-item line could make the model treat injected text as a NEW requirement/fact rather than as
// the content of THIS one fact — the blast radius is bounded (a visitor can only inflate their OWN
// score), but the number must still not lie. A fact answer is meant to be one line; collapsing any
// embedded newline to a space means a forged marker can only ever appear as plain text INSIDE this
// fact's own `text:` field, never as a structurally new line the model could mistake for a real one.
function sanitizeFactText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function buildJudgeInput(adReq: AdRequirementsV1, facts: JudgeFact[]): string {
  const requirementLines = adReq.requirements
    .map((r) => `- id: ${r.id}\n  band: ${r.band}\n  requirement: ${r.requirement}`)
    .join("\n");
  const factLines = facts.length
    ? facts.map((f) => `- id: ${f.id}\n  text: ${sanitizeFactText(f.text)}`).join("\n")
    : "(none — no confirmed facts yet)";
  return `${judgePrompt()}\n${requirementLines}\n\n===CANDIDATE FACTS===\n${factLines}\n`;
}

// #105 review finding 1: the ONE coverage bar, shared by judgedScore.ts (what counts as "met" in the
// breakdown and drops out of dontYet), judge.live.test.ts's "covered" assertion, and card-judge.md's
// own grading scale (which states this number explicitly, so the model knows where the bar is).
// 0.8, not 1.0: the ticket's own flagship case — "ran weekly steering meetings with the CFO" against
// "coordinate business and technical stakeholders" — is a full meaning match in the candidate's own
// words, not a verbatim echo, and a real model grades that shape of answer in the 0.85-0.95 range, not
// exactly 1.0. Requiring literal 1.0 to count as covered would silently fail the ticket's own headline
// AC ("a user's own phrasing... counts") the moment a real model is judging instead of a scripted fake.
// 0.8 sits below where a genuine full-meaning match lands and above where a genuinely partial one does
// (an adjacent domain, a shortfall against a stated bar) — see card-judge.md's grading scale for the
// anchored ranges this value is chosen against.
export const COVERAGE_THRESHOLD = 0.8;

export const JudgeVerdictDoc = z
  .object({
    requirementId: z.string().min(1),
    fit: z.number().min(0).max(1),
    supportingFactId: z.string().min(1).nullable(),
    reason: z.string().min(1),
  })
  .strict();

const JudgeResponseDoc = z
  .object({
    verdicts: z.array(JudgeVerdictDoc).min(1),
  })
  .strict();

export type JudgeVerdict = z.infer<typeof JudgeVerdictDoc>;

/** Code-level backstop, same shape as adReader.ts's clampBlocking: the prompt ASKS for exactly one
 *  verdict per requirement id, but nothing stops a model from skipping one, duplicating one, or
 *  inventing an id that isn't in the advert. Verified here rather than trusted, and any mismatch is
 *  treated as a validation failure (burns the one retry, same as a zod failure) rather than shipping
 *  a card silently missing a verdict for a requirement it does have. */
function verifyCoverage(adReq: AdRequirementsV1, doc: z.infer<typeof JudgeResponseDoc>): JudgeVerdict[] {
  const wantedIds = new Set(adReq.requirements.map((r) => r.id));
  const gotIds = doc.verdicts.map((v) => v.requirementId);
  const gotSet = new Set(gotIds);
  if (gotIds.length !== gotSet.size) throw new Error("judge output duplicated a requirement id");
  const missing = [...wantedIds].filter((id) => !gotSet.has(id));
  const extra = gotIds.filter((id) => !wantedIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `judge output verdict ids don't match the advert's requirement ids (missing: ${missing.join(",")}; extra: ${extra.join(",")})`,
    );
  }
  return doc.verdicts;
}

/** Thrown only for the "two bad answers in a row" case — same distinct-from-a-raw-driver-failure
 *  split adReader.ts's AdReadValidationError draws, for the same reason: makeJudge's catch below
 *  tells the two apart by `instanceof` rather than string-matching a message. */
export class JudgeValidationError extends Error {}

export interface JudgeResult {
  verdicts: JudgeVerdict[];
  cost: AdReadCost;
}

// A candidate with zero confirmed facts has one honest answer for every requirement: no support at
// all. Judging that is not a model question — skip the call entirely rather than pay to have the
// model discover the same certainty a plain length check already has. Real, not estimated: the cost
// record below is `{model: "none", inputTokens: 0, outputTokens: 0}` because zero tokens genuinely
// were spent, not because the true cost is unknown (contrast with adReader.ts's `null` for "unmeasured").
const NO_FACTS_MODEL = "none";

/**
 * Judges one advert's requirements against one candidate's confirmed facts in ONE model call.
 * Mirrors readAdvert's shape: extractJson, a zod gate plus the coverage backstop above, one retry
 * with the validation error appended, throws JudgeValidationError after a second bad answer.
 */
export async function judgeFacts(
  adReq: AdRequirementsV1,
  facts: JudgeFact[],
  llm: LlmClient,
): Promise<JudgeResult> {
  if (facts.length === 0) {
    return {
      verdicts: adReq.requirements.map((r) => ({
        requirementId: r.id,
        fit: 0,
        supportingFactId: null,
        reason: "No confirmed facts yet.",
      })),
      cost: { model: NO_FACTS_MODEL, inputTokens: 0, outputTokens: 0 },
    };
  }

  let lastError = "";
  let costModel = "unknown";
  let totalInputTokens: number | null = 0;
  let totalOutputTokens: number | null = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? buildJudgeInput(adReq, facts)
        : `${buildJudgeInput(adReq, facts)}\n\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const { text, cost } = await completeWithCost(llm, input);
    costModel = cost.model;
    totalInputTokens = addNullable(totalInputTokens, cost.inputTokens);
    totalOutputTokens = addNullable(totalOutputTokens, cost.outputTokens);
    try {
      const doc = JudgeResponseDoc.parse(extractJson(text));
      const verdicts = verifyCoverage(adReq, doc);
      incrementCounter("judge.judged_succeeded");
      if (totalInputTokens !== null && totalOutputTokens !== null) {
        incrementCounter("judge.cost_reads_recorded");
        addToCounter("judge.cost_input_tokens_total", totalInputTokens);
        addToCounter("judge.cost_output_tokens_total", totalOutputTokens);
      }
      return { verdicts, cost: { model: costModel, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new JudgeValidationError(`judge output failed validation twice: ${lastError.slice(0, 500)}`);
}

/** The store key's variable half, alongside adId — #105 review findings 2 and 3 fixed together:
 *
 *  - CONFIRMED FACTS ONLY, no negatives (finding 2). A negative claim is never sent to the model
 *    (buildJudgeInput only ever sees `confirmed`) and its downstream effect — an explicit "no" stays
 *    answered-and-closed — is applied by the EXISTING negativeRequirementIds filter in
 *    routes/onboarding.ts, entirely independent of the judge. Putting negatives in the key bought
 *    nothing (the model input they'd be guarding is identical either way) and cost real correctness:
 *    tapping "No" changed the key, missed the cache, and spent a fresh paid call whose answer could
 *    legitimately differ from the stored one by pure run-to-run variance — surfacing as an
 *    unexplained score movement from an action (a negative) that must never move the number at all.
 *    A positive<->negative flip on the same claim id still changes the fingerprint correctly: the
 *    claim simply leaves `confirmed` (it's fetched from a different store query), so this needs no
 *    special-casing.
 *  - THE AD'S OWN REQUIREMENT IDS (finding 3). Bound into the SAME fingerprint, not left implicit:
 *    without this, a returning visitor with unchanged facts against an advert whose requirement ids
 *    were regenerated (an ad-reader version bump) would hit a stored judgement keyed only by adId +
 *    old facts — every CURRENT requirement id would then miss the verdict map, judgedScore.ts would
 *    read `?? 0` for every one of them, and the card would show 0% with every requirement open,
 *    permanently, since a version-and-fingerprint match means zero model calls ever run again to
 *    correct it. Folding the requirement id set into the key makes a regenerated requirement set a
 *    plain cache miss instead — makeJudge's own coversAllRequirements check below is the second,
 *    belt-and-braces line of defense for the same failure mode, in case the key is ever bypassed
 *    (a manually-crafted row, a future caller that doesn't go through this function).
 *
 *  Order-independent within each half (sorted) so re-fetching the same inputs in a different array
 *  order — confirmed() is a DB read with no ordering guarantee this file wants to depend on — still
 *  hits the same cache entry. */
export function judgementFingerprint(adReq: AdRequirementsV1, confirmed: JudgeFact[]): string {
  const reqIds = [...adReq.requirements.map((r) => r.id)].sort().join(",");
  const factParts = confirmed.map((f) => `${f.id}:${f.text}`).sort();
  return createHash("sha256").update(`reqs:${reqIds}\n${factParts.join("\n")}`).digest("hex").slice(0, 16);
}

/** True when `verdicts` names every one of adReq's CURRENT requirement ids — the belt-and-braces half
 *  of the finding-3 fix above: even if a stale/mismatched record somehow reaches this check (the
 *  fingerprint already makes that the wrong key in practice), a verdict set that doesn't cover the
 *  live requirement set is treated as unusable rather than silently read as "0% on everything". */
function coversAllRequirements(adReq: AdRequirementsV1, verdicts: JudgeVerdict[]): boolean {
  const gotIds = new Set(verdicts.map((v) => v.requirementId));
  return adReq.requirements.every((r) => gotIds.has(r.id));
}

export type JudgeFn = (adReq: AdRequirementsV1, confirmed: JudgeFact[]) => Promise<JudgementRecord | null>;

/**
 * Wires judgeFacts to its persisted, shared cache — same shape as adReader.ts's makeAdReader. A
 * stored record for (adId, judgementFingerprint(adReq, confirmed)) at the CURRENT judgeVersion() is
 * reused with zero model calls (the AC this whole ticket hinges on: ONCE A JUDGEMENT IS STORED,
 * unchanged facts never move the number and never spend again); anything else (never judged, judged
 * against a since-regenerated requirement set, or judged under a stale prompt/contract version)
 * triggers exactly one judge call and persists the result first. This guarantee starts at the FIRST
 * successful store — a card's very first view (nothing stored yet) still makes a live call, and if
 * THAT one times out or fails, routes/onboarding.ts's resolveJudgement falls back to the
 * deterministic tick (decision 6, deliberate); a later retry that succeeds can then show a different
 * number than the fallback did. "The number never moves" is a property of a stored judgement, not of
 * every possible view of a card.
 *
 * Never throws: a failed judgement (model, or the store itself) returns null and is counted — the
 * caller (routes/onboarding.ts's resolveJudgement) is what decides "null means fall back to the
 * deterministic tick", per #105 decision 6. This function only owns "did judging work", not what
 * happens when it doesn't.
 */
export function makeJudge(llm: LlmClient, store: JudgementStore): JudgeFn {
  // Concurrent card/tailor requests for the same (adId, facts) landing together must share one
  // in-flight judgement — identical reasoning to makeAdReader's inFlight map (#104 review finding 7).
  const inFlight = new Map<string, Promise<JudgementRecord | null>>();

  const judgeOne = async (adReq: AdRequirementsV1, confirmed: JudgeFact[]): Promise<JudgementRecord | null> => {
    const fingerprint = judgementFingerprint(adReq, confirmed);
    let cached: JudgementRecord | null;
    try {
      cached = await store.get(adReq.adId, fingerprint);
    } catch (err) {
      incrementCounter("judge.judge_failed");
      console.error(`[ops] judge store.get failed for ${adReq.adId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    // The fingerprint already binds requirement ids in (finding 3), so this coversAllRequirements
    // check should never actually fire in practice — kept as the belt to the key's braces.
    if (cached && cached.version === judgeVersion() && coversAllRequirements(adReq, cached.verdicts)) {
      return cached;
    }

    let result: JudgeResult;
    try {
      result = await judgeFacts(adReq, confirmed, llm);
    } catch (err) {
      incrementCounter("judge.judge_failed");
      console.error(
        `[ops] judge failed (${err instanceof JudgeValidationError ? "model-output-invalid" : "model-call-error"}) for ${adReq.adId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const record: JudgementRecord = {
      verdicts: result.verdicts,
      version: judgeVersion(),
      cost: { ...result.cost, judgedAt: new Date().toISOString() },
    };
    try {
      await store.put(adReq.adId, fingerprint, record);
    } catch (err) {
      // The judgement itself succeeded (and, if a model call was made, was already paid for) — a
      // storage outage shouldn't throw away a good result THIS request can still use. It does mean
      // the result won't be shared (the next request re-judges), same tradeoff makeAdReader accepts.
      incrementCounter("judge.judge_failed");
      console.error(`[ops] judge store.put failed for ${adReq.adId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return record;
  };

  return (adReq, confirmed) => {
    const key = `${adReq.adId}:${judgementFingerprint(adReq, confirmed)}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = judgeOne(adReq, confirmed).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
