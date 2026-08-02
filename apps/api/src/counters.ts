// #103 (E5 slice 2) — small, named, in-process ops counters for the posting pool. Three distinct
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
//   - postings.read_failed: declared here, reads 0 — nothing increments it yet; slice 3 (#104) is
//     the first writer.
//
// In-process and reset-on-restart. That's an accepted limit for this slice, not an oversight: there
// is no persisted metrics store yet, and standing one up before anything needs history would be the
// speculative abstraction this repo avoids (#86 decision 4 makes the same call for user languages).
const counts = {
  "postings.language_skipped": 0,
  "postings.language_undetermined": 0,
  "postings.read_failed": 0,
};

export type CounterName = keyof typeof counts;

export function incrementCounter(name: CounterName): void {
  counts[name]++;
}

/** A fresh snapshot, numbers only — safe to serialize straight onto an open ops route. */
export function readCounters(): Record<CounterName, number> {
  return { ...counts };
}
