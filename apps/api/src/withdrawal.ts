// #107 (E5 slice 6, D3) — the withdrawal predicate. Pure arithmetic over one advert's own requirement
// set and a session's ALREADY-READ eligibility facts; no IO of its own. Consumed by every surface that
// renders an advert (routes/onboarding.ts: the deck, /want, and tailorTarget) so the same rule holds
// wherever a posting could otherwise reach a visitor — never re-derived per call site.
//
// CONTEXT.md's own definition: a blocking requirement is established ONLY when the advert states it
// as mandatory AND the user has explicitly said they do not meet it — a vague advert or an unasked
// question never establishes one. This function is that definition made real. All three conditions
// below must hold for one requirement, or nothing withdraws:
//   1. kind === "blocking" — the advert was explicit (the reader's own clampBlocking, adReader.ts,
//      already guarantees a blocking requirement carries a hard-gate eligibilityDimension, and — as
//      of #107, D1 — a language/certification one also carries an eligibilitySubject).
//   2. a STORED fact exists at this requirement's (dimension, scope). No fact at all — never asked,
//      or asked at a DIFFERENT scope — reads as unknown, and an unknown never withdraws. Always.
//   3. that fact's value is an EXPLICIT "no" (isExplicitNo below) for the dimension. "Some, but not
//      for work" is not "I don't speak it" and must never withdraw (the spec's own regression case).
import type { AdRequirementV1, AdRequirementsV1, EligibilityDimension } from "@jobcrush/contracts";
import type { EligibilityFact } from "./eligibility.js";

/** The eligibility-store scope one requirement's blocking check reads at, or null when there is no
 *  safe way to resolve one — a null scope means "cannot determine, never withdraw", never "fall back
 *  to the global scope".
 *
 *  work-rights ALWAYS returns null — code-review M1 (2026-08-03): the discovery question is asked
 *  ONCE, city-scoped in its own wording ("Can you already work in {city}...?"), but STORED globally
 *  (ANY_FAMILY) with no visitor-location fact attached to it. apps/api/data/sample-postings.json
 *  spans multiple countries (Australia, Hong Kong SAR, Vietnam, China); an Australian visitor
 *  job-hunting in Hong Kong who answers "Not yet — I'd need sponsorship" about Hong Kong would
 *  otherwise have every right-to-work-demanding AUSTRALIAN posting silently deleted too — exactly the
 *  silent-deletion-of-a-winnable-job failure #86 names as the worst this engine can make. This is the
 *  SAME conclusion eligibilityDiscovery.ts's own must-fix-7 comment already reached for the mirror-
 *  image case (a posting's applicantLocationRequirements vs. a visitor's city): "which countries this
 *  job accepts applicants from" and "can THIS visitor work in THEIR city without sponsorship" do not
 *  resolve into each other without a visitor-location fact nothing in this codebase collects.
 *  work-rights stays fully wired through the contract, the reader, and isExplicitNo below — it simply
 *  never reaches a withdrawal via this function. Resolvable the day a real visitor-location fact
 *  exists (out of scope here); until then, null, always.
 *
 *  language/certification read at their own eligibilitySubject — absent (a fixture predating #107, or
 *  a reader output the clamp somehow missed) means there is no safe way to know WHICH language/
 *  certification is meant, so this requirement can never withdraw anything rather than risk matching
 *  the wrong subject. years-experience/degree are never blocking (adReader.ts's own hard-gate clamp),
 *  so they fall through to null defensively rather than being special-cased out of the switch. */
function scopeFor(dimension: EligibilityDimension, subject: string | undefined): string | null {
  if (dimension === "work-rights") return null;
  if (dimension === "language" || dimension === "certification") return subject ?? null;
  return null;
}

/** Trimmed + case-folded — code-review M4: a reader-produced eligibilitySubject ("english", "
 *  Mandarin ") must still match the store's canonical scope ("English") or this whole rule silently
 *  never fires. A safe direction on its own (never-withdraws is always the fail-safe outcome), but a
 *  needless no-op worth the one-line fix.
 *
 *  Exported (2026-08-04, no behaviour change) so routes/onboarding.ts's withdrawal-reporting tally
 *  (the reveal's "N jobs needed Mandarin" line) can re-derive the SAME match this function's own
 *  caller (findWithdrawingRequirement) already made, to recover the fact's exact canonical casing —
 *  never a second predicate, never a re-decision of any posting's fate. */
export function normalizeScope(s: string): string {
  return s.trim().toLowerCase();
}

/** True when `value` is an EXPLICIT "no" for `dimension` — the one thing that may ever withdraw a
 *  posting (#86 decision 3). Every other recorded value (and, per the caller, every UNRECORDED one)
 *  leaves the job in the deck. */
function isExplicitNo(dimension: EligibilityDimension, value: string): boolean {
  if (dimension === "work-rights") return value === "needs-sponsorship";
  // "conversational" is deliberately NOT a no — the spec's own second regression case: a "some but
  // not for work" fluency must never withdraw. #123 code-review must-fix 1 (2026-08-04): the
  // languages question is now a binary multi-select (tick = professional, unticked = none) and has
  // no option that WRITES "conversational" any more — the owner's sanctioned trade for that shape
  // (docs/research/languages-from-the-corpus.md's "Decision taken" section, and the constant in
  // eligibilityDiscovery.ts). This branch is NOT dead: a fact stored before #123, or by any future
  // surface that reintroduces a three-way answer, still carries this value, and it must still never
  // withdraw — retained on purpose, not orphaned.
  if (dimension === "language") return value === "none";
  // certification is wired through on purpose (D3: "don't special-case it away") even though no
  // product surface today ever WRITES a certification eligibility fact — see eligibilityDiscovery.ts's
  // ASK_DIMENSIONS. This branch is reachable the day that changes; until then a fact for this
  // dimension is simply never found (condition 2 above already short-circuits), so this is dead in
  // practice, not silently absent from the switch.
  if (dimension === "certification") return false;
  return false; // years-experience/degree are never blocking
}

/** The first requirement (in the advert's own rank order) that genuinely withdraws this posting from
 *  this session's deck, or null when nothing does. `facts` is whatever the caller already read
 *  (EligibilityFact[]) — never fetched here. */
export function findWithdrawingRequirement(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
): AdRequirementV1 | null {
  for (const req of adReq.requirements) {
    if (req.kind !== "blocking") continue;
    const dimension = req.eligibilityDimension;
    if (!dimension) continue; // defensive — the reader's clamp already guarantees this is set
    const scope = scopeFor(dimension, req.eligibilitySubject);
    if (scope === null) continue;
    const fact = facts.find(
      (f) => f.dimension === dimension && normalizeScope(f.familyId) === normalizeScope(scope),
    );
    if (!fact) continue; // never asked (or asked at a different scope) — unknown, never withdraws
    if (isExplicitNo(dimension, fact.value)) return req;
  }
  return null;
}
