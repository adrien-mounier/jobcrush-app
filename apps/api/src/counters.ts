// #103 (E5 slice 2): small, named, in-process ops counters for the posting pool. Three distinct
// numbers, deliberately never folded together:
//   - postings.language_skipped: confirmed non-served-language posting, held back at ingest. A SKIP,
//     never a failure (#86 AC: the slice-3 failure alarm must not fire on language skips, or it
//     screams on every Hong Kong pull and gets ignored).
//   - postings.language_undetermined: detectLanguage() couldn't judge. **Treat a rise here as a
//     suspected fault, never as routine.** Measured in QA 2026-08-02: an ATS bullet-list advert
//     ("Responsibilities: - Manage end-to-end delivery") scores 0.03 on the English function-word
//     test and a bare skills blob scores 0.00, so genuinely English adverts in those formats land
//     here and are then hidden from EVERY reader. Held separate from the skip counter for exactly
//     that reason (#103 code review finding 3) — folding them together would let real English jobs
//     disappear behind a number that reads as benign.
//   - postings.read_failed: a model read could not be turned into a usable AdRequirementsV1 (or the
//     store itself failed) — the read-failure alarm's numerator. Declared here since #103; #104
//     (E5 slice 3, adReader.ts) is the first writer.
//   - postings.fixture_invalid: a HAND-AUTHORED fixture failed to parse (e5stub.ts). Deliberately
//     its own counter, not folded into postings.read_failed (#104 review finding 6): a broken
//     fixture has nothing to do with the model, so it must not move the read-failure alarm's rate —
//     one malformed fixture would otherwise pin the alarm at 100% with zero model calls made and
//     point an operator straight at the wrong system. Counted once per bad fixture at load
//     (e5stub.ts caches listAdRequirements()'s parsed result), matching the "counted once" property
//     the other ingest-time counters already have — parseAdRequirementsList itself is a plain pure
//     function and increments on every call; it's listAdRequirements()'s cache that makes production
//     usage count-once.
//
// #104 (E5 slice 3) adds nine more, namespaced adReader.* to stay visually distinct from the
// ingest-time postings.* counters above even though they share this one flat counts object and one
// /ops/counters route:
//   - adReader.read_succeeded: a model read produced a valid AdRequirementsV1. Denominator (with
//     read_failed) for the failure-rate alarm below.
//   - adReader.language_skipped: a posting held back at READ time because its language isn't
//     served — separate from postings.language_skipped (ingest time) so nothing double-counts. In
//     production this never fires on its own (eligiblePostings() already keeps a non-served
//     posting from ever reaching the reader); it exists as defense-in-depth inside adReader.ts
//     itself for a caller that skips that filter.
//   - adReader.requirements_produced / adReader.requirements_blocking: raw totals across every
//     successful read — the numerator/denominator for the blocking rate (AC: "the blocking rate is
//     observable"). Measured 2026-08-02: without the blocking definition pinned in the prompt, one
//     advert alone produced 4 blocking requirements, including a stakeholder-communication
//     capability that should never block. A sudden rise in this ratio is that regression recurring.
//   - adReader.blocking_clamped: how many blocking calls were down-classified to ordinary by the
//     code-level enforcement in adReader.ts (the mechanical safety net behind the prompt's
//     definition). A rising clamp count means the model is drifting toward over-blocking — the
//     output stays safe, but the trend is worth an operator's attention.
//   - adReader.cost_reads_recorded / cost_input_tokens_total / cost_output_tokens_total: the unit
//     economics #86 asked to be KNOWN, not estimated (#104 review finding 8 — cost was written per
//     advert but nothing ever exposed it, and it died with the process when DATABASE_URL was unset).
//     reads_recorded counts only reads whose usage was actually measured (AnthropicLlm's
//     completeWithUsage); a driver with no usage data (ClaudeCliLlm) contributes to
//     read_succeeded but not here, so reads_recorded / read_succeeded also tells an operator what
//     fraction of reads have real cost data at all. total ÷ reads_recorded is the average cost per
//     advert read.
//
// In-process and reset-on-restart. That's an accepted limit for this slice, not an oversight: there
// is no persisted metrics store yet, and standing one up before anything needs history would be the
// speculative abstraction this repo avoids (#86 decision 4 makes the same call for user languages).
const counts = {
  "postings.language_skipped": 0,
  "postings.language_undetermined": 0,
  "postings.read_failed": 0,
  "postings.fixture_invalid": 0,
  "adReader.read_succeeded": 0,
  "adReader.language_skipped": 0,
  "adReader.requirements_produced": 0,
  "adReader.requirements_blocking": 0,
  "adReader.blocking_clamped": 0,
  "adReader.cost_reads_recorded": 0,
  "adReader.cost_input_tokens_total": 0,
  "adReader.cost_output_tokens_total": 0,
};

export type CounterName = keyof typeof counts;

export function incrementCounter(name: CounterName): void {
  counts[name]++;
  // The failure-rate alarm can only move on these two names; check on every touch rather than
  // asking every call site to remember to (a rate an operator has to remember to poll for isn't
  // an alarm — see checkReadFailureAlarm's doc below).
  if (name === "postings.read_failed" || name === "adReader.read_succeeded") maybeLogAlarmTransition();
}

/** Batch add — requirement/blocking counts arrive per advert as a batch (e.g. "this read produced
 *  6 requirements, 1 blocking"), not one unit at a time, so this avoids N calls for one read. */
export function addToCounter(name: CounterName, n: number): void {
  counts[name] += n;
}

/** A fresh snapshot, numbers only — safe to serialize straight onto an open ops route. */
export function readCounters(): Record<CounterName, number> {
  return { ...counts };
}

// --- the read-failure alarm (AC: "an alarm exists" on a rising read-failure rate) ----------------
// Simplest honest thing per the ticket: a threshold plus a minimum sample size, computed on demand
// from the counters above — no metrics backend, no persisted alarm state (same accepted in-process
// limit as the counters themselves).
export const READ_FAILURE_ALARM = {
  threshold: 0.2, // >20% of read attempts failing is a prompt/provider regression, not noise
  minSamples: 5, // below this, one bad advert would swing the rate wildly — wait for real signal
} as const;

export interface ReadFailureAlarm {
  firing: boolean;
  rate: number; // failed / (failed + succeeded); 0 when there have been no attempts yet
  sampleSize: number;
}

/** Pure — takes explicit counts rather than reading the module's live counters, so the threshold
 *  and sample-size logic is testable with exact numbers instead of fighting the shared counters
 *  singleton's cross-test accumulation (see resetCountersForTest's doc for why that matters). */
export function computeReadFailureAlarm(failed: number, succeeded: number): ReadFailureAlarm {
  const sampleSize = failed + succeeded;
  const rate = sampleSize > 0 ? failed / sampleSize : 0;
  return { firing: sampleSize >= READ_FAILURE_ALARM.minSamples && rate > READ_FAILURE_ALARM.threshold, rate, sampleSize };
}

/** The alarm's current state, straight off the live counters — what /ops/counters reports. */
export function readFailureAlarm(): ReadFailureAlarm {
  return computeReadFailureAlarm(counts["postings.read_failed"], counts["adReader.read_succeeded"]);
}

// Tracks whether the alarm was already firing, so the log line below fires once on the TRANSITION
// into alarm state, not on every subsequent failure while it stays firing — spamming the log at
// exactly the moment an operator needs to find the one line that matters would defeat the point.
let alarmWasFiring = false;

function maybeLogAlarmTransition(): void {
  const alarm = readFailureAlarm();
  if (alarm.firing && !alarmWasFiring) {
    console.error(
      `[ops] adReader read-failure alarm firing: ${(alarm.rate * 100).toFixed(1)}% of ${alarm.sampleSize} reads failed`,
    );
  }
  alarmWasFiring = alarm.firing;
}

/** Test-only: zeroes every counter and the alarm's latch. Never called by production code — it
 *  exists because counts is a module-level singleton with no other reset, and the alarm/threshold
 *  tests need a clean slate to assert exact rates rather than depending on whatever else happened
 *  to run earlier in the same test file's shared module instance. */
export function resetCountersForTest(): void {
  for (const key of Object.keys(counts) as CounterName[]) counts[key] = 0;
  alarmWasFiring = false;
}
