// #162 — years of experience is WORKED OUT from the dated job records, never asked.
//
// ADR-0008 clause 2 (the Mei rule) is the whole reason this module exists: a worked-out value is a
// regenerable copy, so asking a person for it collects an answer the next rebuild deletes.
// `years-experience` therefore never appears in eligibilityDiscovery.ts's ASK_DIMENSIONS — the
// falsifiable check the ADR itself names. Clause 3 says what to ask instead: the missing part
// UNDERNEATH, which for a dated block is its unknown end (dateHoleQuestions below).
//
// Three jobs this module owns, and nothing else does:
//   1. computeYearsWorked — calendar time actually worked, overlaps merged, gaps excluded.
//   2. dateHoleQuestions / parseEndAnswer / answerJobDateHole — the ask-for-the-dates-underneath flow.
//   3. syncWorkedYears — the stored total is a regenerable COPY (#128 §4): recomputed at every door
//      that can change a job record, with a disagreement counted, never silently absorbed.
import type { DeckSummary, JobBlockView, MinedDate, MinedEndValue } from "@jobcrush/contracts";
import type { DiscoveryQuestion } from "./discovery.js";
import { ANY_FAMILY, type EligibilityStore } from "./eligibility.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import { incrementCounter } from "./counters.js";

/** The two states #162 AC6 requires to read differently. A confident zero ("we read your history and
 *  there is no work in it") is `computed` with `years: 0`; an unreadable or never-run history is
 *  `untestable` — an UNKNOWN, which #86 decision 3 forbids from lowering anything. */
export type WorkedYears =
  | { state: "computed"; years: number; unknownEnds: number }
  | { state: "untestable" };

/** Months since year 0, the unit every interval is merged in. A year-precision date carries no
 *  month by contract (jobBlock.ts), so a bound has to be chosen: a start reads as January and an end
 *  as December — the plain reading of "2019 – 2021" as three years. How a coarse date is WRITTEN on
 *  the page is #143's, deliberately not decided here. */
const startMonth = (d: MinedDate): number => d.year * 12 + ((d.month ?? 1) - 1);
const endMonthExclusive = (d: MinedDate): number => d.year * 12 + (d.precision === "month" ? d.month! : 12);

const nowMonthExclusive = (now: Date): number => now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;

/** One block's worked span as a half-open [from, to) month interval, or null when it contributes
 *  nothing. An UNKNOWN end contributes zero — the #143 hole this module then asks about, rather than
 *  guessing a length nobody stated.
 *
 *  #162 QA finding 2: the end is CLAMPED TO TODAY, whatever it says. An `ongoing` job always was;
 *  an `ended` one was taken verbatim, so a typo in the date box ("December 2029", "December 9999")
 *  landed straight on the number adverts gate on — 9999 computed as 7,978 years — and no screen shows
 *  the total back, so nobody could catch it. Nobody has worked a month that has not happened yet, so
 *  the clamp costs nothing legitimate and it also covers a future date the MINER read off a CV, not
 *  just one a person typed. The stored record keeps the date the person gave; only the arithmetic
 *  stops at today. */
function span(block: JobBlockView, now: Date): { from: number; to: number } | null {
  if (!block.countsTowardExperience) return null;
  const end: MinedEndValue = block.end.value;
  const today = nowMonthExclusive(now);
  const from = startMonth(block.start.value);
  const stated =
    end.state === "ongoing" ? today : end.state === "ended" ? endMonthExclusive(end.date) : null;
  const to = stated === null ? null : Math.min(stated, today);
  if (to === null || to <= from) return null;
  return { from, to };
}

/** Calendar time actually worked: overlapping months counted ONCE, gaps counted zero, part-time
 *  counted in full (nothing here reads hours), and only blocks whose kind counts as work included
 *  (countsTowardExperience — jobBlock.ts owns that rule; an education block contributes nothing).
 *
 *  `read` is the miner's own three-way run state. With no work blocks at all the two honest answers
 *  differ: a run that SUCCEEDED and found none is a confident zero; a run that failed or never
 *  happened is untestable. A later failed re-read never demotes blocks that are still stored. */
export function computeYearsWorked(
  blocks: readonly JobBlockView[],
  read: DeckSummary["read"],
  now: Date = new Date(),
): WorkedYears {
  const counting = blocks.filter((b) => b.countsTowardExperience);
  if (counting.length === 0) {
    return read.status === "ok" ? { state: "computed", years: 0, unknownEnds: 0 } : { state: "untestable" };
  }
  const unknownEnds = counting.filter((b) => b.end.value.state === "unknown").length;
  const spans = counting
    .map((b) => span(b, now))
    .filter((s): s is { from: number; to: number } => s !== null)
    .sort((a, b) => a.from - b.from);

  let months = 0;
  let cursor = -Infinity;
  for (const s of spans) {
    const from = Math.max(s.from, cursor);
    if (s.to > from) months += s.to - from;
    cursor = Math.max(cursor, s.to);
  }
  // One decimal: the number a card compares against a "5+ years" bar, not a precision claim.
  return { state: "computed", years: Math.round((months / 12) * 10) / 10, unknownEnds };
}

// --- the question underneath (ADR-0008 clause 3, #143) ----------------------------------------

export const JOB_DATE_ITEM_PREFIX = "job-date-";
export const isJobDateItemId = (itemId: string): boolean => itemId.startsWith(JOB_DATE_ITEM_PREFIX);
const blockIdOf = (itemId: string): string => itemId.slice(JOB_DATE_ITEM_PREFIX.length);

/** #143 / AC4 — the reason is said ALOUD, on the question itself. An unknown end contributes zero,
 *  so a 22-year career reads as 19 and the person is entitled to know why this one matters before
 *  deciding to answer it. */
const END_HOLE_CONSEQUENCE =
  "I don't have an end date for this job, so right now it adds nothing to your years of experience —" +
  " that makes your total read shorter than it is, and jobs that ask for a minimum stop matching you." +
  ' Type the month and year you left, or "still there".';

/** One question per work block with an unknown end — the only date hole a job record can actually
 *  carry (a start is required by the contract, so it can never be missing). Free text (`options: []`),
 *  the shape the ask dock already renders for a floor item in the person's own words. */
export function dateHoleQuestions(blocks: readonly JobBlockView[]): DiscoveryQuestion[] {
  return blocks
    .filter((b) => b.countsTowardExperience && b.end.value.state === "unknown")
    .map((b) => ({
      itemId: `${JOB_DATE_ITEM_PREFIX}${b.id}`,
      question: `When did you leave ${b.employer.value}?`,
      consequence: END_HOLE_CONSEQUENCE,
      options: [],
      cvSection: "experience" as const,
    }));
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const ended = (year: number, month: number | null): MinedEndValue => ({
  state: "ended",
  date: month === null ? { year, month: null, precision: "year" } : { year, month, precision: "month" },
});

/** A free-text end answer -> the contract's own end value, or null when it says nothing usable (a
 *  400 at the route, never a stored guess). Accepts "still there"/"present", "March 2019"/"Mar 2019",
 *  "03/2019", "2019-03", and a bare "2019" (year precision — the contract's own way of saying the
 *  month was never stated). */
export function parseEndAnswer(answer: string): MinedEndValue | null {
  const text = answer.trim().toLowerCase();
  if (!text) return null;
  if (/\b(still|current|currently|present|now|ongoing|today)\b/.test(text)) return { state: "ongoing" };

  const named = text.match(/([a-z]{3,})\s+(\d{4})/);
  if (named) {
    const stem = named[1]!.slice(0, 3);
    const index = MONTHS.findIndex((m) => m.startsWith(stem));
    if (index >= 0) return ended(Number(named[2]), index + 1);
  }
  const numeric = text.match(/^(\d{1,2})[/-](\d{4})$/) ?? null;
  if (numeric && Number(numeric[1]) >= 1 && Number(numeric[1]) <= 12) {
    return ended(Number(numeric[2]), Number(numeric[1]));
  }
  const isoish = text.match(/^(\d{4})[/-](\d{1,2})$/) ?? null;
  if (isoish && Number(isoish[2]) >= 1 && Number(isoish[2]) <= 12) {
    return ended(Number(isoish[1]), Number(isoish[2]));
  }
  const bareYear = text.match(/^(\d{4})$/);
  if (bareYear) return ended(Number(bareYear[1]), null);
  return null;
}

// --- the stored total, and the backstop that keeps it honest ----------------------------------

/** The label the stored copy renders under. Names its own origin: nobody typed this number. */
export const WORKED_YEARS_LABEL = "Years of experience (worked out from your dated jobs)";

/** AC5's backstop. The stored eligibility fact is a regenerable COPY (#128 §4) — the job records
 *  underneath always win — so this recomputes from those records, COMPARES against the stored copy,
 *  counts any disagreement (`years.drift_detected`) and writes the fresh value over it. Called at
 *  every door that can change a job record (ingest, correct, detach, resolve-match, a date answer),
 *  so a read anywhere else sees the corrected total without having to recompute.
 *
 *  An untestable history leaves the stored copy alone rather than deleting it: a failed re-read is
 *  our parsing gap, and #86 decision 3's unknown-is-not-absence applies to our own copy too. */
export async function syncWorkedYears(
  eligibility: EligibilityStore,
  sessionId: string,
  blocks: readonly JobBlockView[],
  read: DeckSummary["read"],
  now: Date = new Date(),
  // #162 QA finding 3: `years.drift_detected` was counted on EVERY sync, and every sync ran straight
  // after a door that had just changed a record — so the happy path always "drifted" and the counter
  // was 100% noise, unable to tell "a correction landed" from "a copy went stale". It is counted only
  // where nothing SHOULD have changed: a READ of the records (verifyWorkedYears, below). A mutation
  // door expects a new number and says so.
  countDrift = false,
): Promise<WorkedYears> {
  const worked = computeYearsWorked(blocks, read, now);
  if (worked.state === "untestable") return worked;
  const stored = await eligibility.get(sessionId, "years-experience", ANY_FAMILY);
  const fresh = String(worked.years);
  if (countDrift && stored && stored.value !== fresh) incrementCounter("years.drift_detected");
  if (!stored || stored.value !== fresh) {
    await eligibility.put(sessionId, {
      dimension: "years-experience",
      familyId: ANY_FAMILY,
      value: fresh,
      label: WORKED_YEARS_LABEL,
    });
  }
  return worked;
}

/** Reads the records and re-derives the total — the shape every mutation door wants. A new number is
 *  expected here (a record just changed), so this never counts drift. */
export async function refreshWorkedYears(
  jobBlocks: JobBlockStore,
  eligibility: EligibilityStore,
  sessionId: string,
): Promise<WorkedYears> {
  const [blocks, summary] = await Promise.all([jobBlocks.list(sessionId), jobBlocks.summary(sessionId)]);
  return syncWorkedYears(eligibility, sessionId, blocks, summary.read);
}

/** AC5's backstop where it can actually mean something: a READ of the job records re-derives the
 *  total and compares it with the stored copy. Nothing changed the records on this path, so a
 *  disagreement is a REAL event — a door that mutated a record without re-deriving — and it is
 *  counted (`years.drift_detected`) and repaired, never silently absorbed. This is also the answer to
 *  "when ANYTHING reads the total, it reflects the correction": the copy is checked on the way past,
 *  not trusted forever. */
export async function verifyWorkedYears(
  eligibility: EligibilityStore,
  sessionId: string,
  blocks: readonly JobBlockView[],
  read: DeckSummary["read"],
): Promise<WorkedYears> {
  return syncWorkedYears(eligibility, sessionId, blocks, read, new Date(), true);
}

export type JobDateAnswerResult = { ok: true } | { ok: false; code: string; message: string };

/** The answer path for a date-hole question: parse, correct the job record through the SAME
 *  correction door a person's confirm-screen edit uses (so the origin becomes "corrected" and the
 *  original read stays reachable), then re-derive the total. Lives here rather than in the route so
 *  routes/onboarding.ts stays a thin entry (the ratchet). */
export async function answerJobDateHole(
  jobBlocks: JobBlockStore,
  eligibility: EligibilityStore,
  sessionId: string,
  itemId: string,
  answer: string | undefined,
): Promise<JobDateAnswerResult> {
  if (answer === undefined) {
    return { ok: false, code: "invalid_answer", message: "this item requires a single answer" };
  }
  const end = parseEndAnswer(answer);
  if (!end) {
    return {
      ok: false,
      code: "invalid_answer",
      message: 'I could not read that as a date. Try a month and year like "March 2019", or "still there".',
    };
  }
  const found = await jobBlocks.correct(sessionId, blockIdOf(itemId), "end", end);
  if (!found) return { ok: false, code: "not_found", message: "unknown job block" };
  await refreshWorkedYears(jobBlocks, eligibility, sessionId);
  return { ok: true };
}
